// Package document gère les justificatifs IFU des gérants (décision D10) : contrôle du type
// par les magic bytes, suppression des métadonnées des images, chiffrement par enveloppe
// et stockage. Les fichiers ne sont jamais servis publiquement.
package document

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg" // décodeurs utilisés par image.DecodeConfig
	_ "image/png"
	"io"
	"net/http"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/platform/crypto"
	"gostation/backend/internal/platform/storage"
)

// Types acceptés.
const (
	MIMEPDF  = "application/pdf"
	MIMEJPEG = "image/jpeg"
	MIMEPNG  = "image/png"
)

// Codes d'erreur stables des téléversements.
const (
	CodeUnsupportedType = "upload.unsupported_type"
	CodeTooLarge        = "upload.too_large"
	CodeInvalidFile     = "upload.invalid_file"
)

// Prepared est un justificatif validé et nettoyé, prêt à être chiffré.
type Prepared struct {
	Data []byte
	MIME string
}

// Stored décrit un justificatif chiffré et stocké (colonnes document_* de stations).
type Stored struct {
	ObjectKey  string
	WrappedKey []byte
	SHA256     []byte
	MIME       string
}

// Service valide, chiffre, stocke et relit les justificatifs.
type Service struct {
	storage  storage.Storage
	envelope *crypto.Envelope
	maxBytes int64
}

// NewService construit le service. maxBytes = 5 Mo (D10).
func NewService(st storage.Storage, env *crypto.Envelope, maxBytes int64) *Service {
	return &Service{storage: st, envelope: env, maxBytes: maxBytes}
}

// MaxBytes est la taille maximale d'un justificatif.
func (s *Service) MaxBytes() int64 { return s.maxBytes }

// Prepare lit le fichier (borné à maxBytes), détecte son type réel par les magic bytes
// (l'extension et le Content-Type déclarés sont ignorés) et retire les métadonnées des images.
func (s *Service) Prepare(r io.Reader) (Prepared, error) {
	data, err := io.ReadAll(io.LimitReader(r, s.maxBytes+1))
	if err != nil {
		return Prepared{}, fmt.Errorf("document: read: %w", err)
	}
	if int64(len(data)) > s.maxBytes {
		return Prepared{}, apperr.New(http.StatusRequestEntityTooLarge, CodeTooLarge,
			fmt.Sprintf("The document must not exceed %d MB.", s.maxBytes>>20))
	}
	if len(data) == 0 {
		return Prepared{}, apperr.New(http.StatusUnprocessableEntity, CodeInvalidFile, "The document is empty.")
	}

	mime := http.DetectContentType(data)
	switch mime {
	case MIMEPDF:
		return Prepared{Data: data, MIME: mime}, nil
	case MIMEJPEG, MIMEPNG:
		clean, err := StripMetadata(data, mime)
		if err != nil {
			return Prepared{}, apperr.New(http.StatusUnprocessableEntity, CodeInvalidFile, "The image is corrupted.").Wrap(err)
		}
		if _, _, err := image.DecodeConfig(bytes.NewReader(clean)); err != nil {
			return Prepared{}, apperr.New(http.StatusUnprocessableEntity, CodeInvalidFile, "The image is corrupted.").Wrap(err)
		}
		return Prepared{Data: clean, MIME: mime}, nil
	default:
		return Prepared{}, apperr.New(http.StatusUnsupportedMediaType, CodeUnsupportedType,
			"Only PDF, JPEG and PNG documents are accepted.")
	}
}

// Save chiffre (une DEK par fichier, liée à la clé de l'objet) et stocke le justificatif.
func (s *Service) Save(ctx context.Context, owner uuid.UUID, p Prepared) (Stored, error) {
	key := fmt.Sprintf("stations/%s/%s.bin", owner, uuid.NewString())
	ct, wrapped, err := s.envelope.Seal(p.Data, []byte(key))
	if err != nil {
		return Stored{}, fmt.Errorf("document: encrypt: %w", err)
	}
	if err := s.storage.Put(ctx, key, ct); err != nil {
		return Stored{}, fmt.Errorf("document: store: %w", err)
	}
	sum := sha256.Sum256(p.Data)
	return Stored{ObjectKey: key, WrappedKey: wrapped, SHA256: sum[:], MIME: p.MIME}, nil
}

// Delete supprime un objet stocké (nettoyage si la transaction échoue).
func (s *Service) Delete(ctx context.Context, key string) error { return s.storage.Delete(ctx, key) }

// ErrIntegrity signale un fichier altéré (empreinte différente de celle enregistrée).
var ErrIntegrity = errors.New("document: integrity check failed")

// Open relit et déchiffre un justificatif, puis vérifie son empreinte.
func (s *Service) Open(ctx context.Context, st Stored) ([]byte, error) {
	ct, err := s.storage.Get(ctx, st.ObjectKey)
	if err != nil {
		return nil, fmt.Errorf("document: load: %w", err)
	}
	data, err := s.envelope.Open(ct, st.WrappedKey, []byte(st.ObjectKey))
	if err != nil {
		return nil, fmt.Errorf("document: decrypt: %w", err)
	}
	if sum := sha256.Sum256(data); !bytes.Equal(sum[:], st.SHA256) {
		return nil, ErrIntegrity
	}
	return data, nil
}

// StripMetadata retire les métadonnées d'une image sans la recompresser (aucune perte).
func StripMetadata(data []byte, mime string) ([]byte, error) {
	switch mime {
	case MIMEJPEG:
		return stripJPEG(data)
	case MIMEPNG:
		return stripPNG(data)
	default:
		return data, nil
	}
}

// stripJPEG supprime les segments APP1 (EXIF, XMP), APP3 à APP13 (dont IPTC/Photoshop), APP15
// et COM. Restent APP0 (JFIF), APP2 (profil ICC) et APP14 (Adobe, nécessaire aux JPEG CMJN).
// Les données compressées qui suivent SOS sont copiées telles quelles.
func stripJPEG(data []byte) ([]byte, error) {
	if len(data) < 4 || data[0] != 0xFF || data[1] != 0xD8 {
		return nil, errors.New("not a JPEG")
	}
	out := bytes.NewBuffer(make([]byte, 0, len(data)))
	out.Write(data[:2])
	i := 2
	for i < len(data) {
		if data[i] != 0xFF {
			return nil, fmt.Errorf("jpeg: expected marker at offset %d", i)
		}
		for i < len(data) && data[i] == 0xFF { // octets de remplissage
			i++
		}
		if i >= len(data) {
			return nil, errors.New("jpeg: truncated")
		}
		marker := data[i]
		i++
		switch {
		case marker == 0xD9: // EOI
			out.Write([]byte{0xFF, marker})
			return out.Bytes(), nil
		case marker >= 0xD0 && marker <= 0xD7, marker == 0x01: // RSTn, TEM : sans longueur
			out.Write([]byte{0xFF, marker})
			continue
		}
		if i+2 > len(data) {
			return nil, errors.New("jpeg: truncated segment length")
		}
		length := int(binary.BigEndian.Uint16(data[i : i+2]))
		if length < 2 || i+length > len(data) {
			return nil, errors.New("jpeg: invalid segment length")
		}
		segment := data[i : i+length]
		i += length
		if marker == 0xDA { // SOS : on garde le reste du flux tel quel
			out.Write([]byte{0xFF, marker})
			out.Write(segment)
			out.Write(data[i:])
			return out.Bytes(), nil
		}
		drop := marker == 0xE1 || (marker >= 0xE3 && marker <= 0xED) || marker == 0xEF || marker == 0xFE
		if !drop {
			out.Write([]byte{0xFF, marker})
			out.Write(segment)
		}
	}
	return nil, errors.New("jpeg: missing image data")
}

var pngSignature = []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'}

// stripPNG supprime les chunks porteurs de métadonnées : eXIf, tEXt, zTXt, iTXt, tIME.
func stripPNG(data []byte) ([]byte, error) {
	if !bytes.HasPrefix(data, pngSignature) {
		return nil, errors.New("not a PNG")
	}
	drop := map[string]bool{"eXIf": true, "tEXt": true, "zTXt": true, "iTXt": true, "tIME": true}
	out := bytes.NewBuffer(make([]byte, 0, len(data)))
	out.Write(pngSignature)
	i := len(pngSignature)
	for i+12 <= len(data) {
		length := int(binary.BigEndian.Uint32(data[i : i+4]))
		if length < 0 || i+12+length > len(data) {
			return nil, errors.New("png: invalid chunk length")
		}
		chunk := data[i : i+12+length]
		typ := string(data[i+4 : i+8])
		i += 12 + length
		if !drop[typ] {
			out.Write(chunk)
		}
		if typ == "IEND" {
			return out.Bytes(), nil
		}
	}
	return nil, errors.New("png: missing IEND")
}
