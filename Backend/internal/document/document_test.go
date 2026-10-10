package document_test

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/document"
	"gostation/backend/internal/platform/crypto"
	"gostation/backend/internal/platform/storage"
)

func newService(t *testing.T) *document.Service {
	t.Helper()
	st, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	env, err := crypto.NewEnvelope(bytes.Repeat([]byte{3}, 32))
	if err != nil {
		t.Fatal(err)
	}
	return document.NewService(st, env, 64<<10)
}

func sampleImage() image.Image {
	img := image.NewRGBA(image.Rect(0, 0, 8, 8))
	for i := range 8 {
		img.Set(i, i, color.RGBA{R: 0xEA, G: 0x58, B: 0x0C, A: 0xFF})
	}
	return img
}

// JPEGWithEXIF renvoie un JPEG valide dans lequel un segment APP1 « Exif » (avec des
// coordonnées GPS factices) et un commentaire COM ont été insérés après SOI.
func jpegWithEXIF(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, sampleImage(), nil); err != nil {
		t.Fatal(err)
	}
	raw := buf.Bytes()
	segment := func(marker byte, payload []byte) []byte {
		s := []byte{0xFF, marker, 0, 0}
		binary.BigEndian.PutUint16(s[2:], uint16(len(payload)+2)) //nolint:gosec // petite charge utile de test
		return append(s, payload...)
	}
	exif := segment(0xE1, []byte("Exif\x00\x00GPSLatitude=6.3703;GPSLongitude=2.4253;Owner=Kofi"))
	com := segment(0xFE, []byte("shot on Phone X"))
	out := append([]byte{}, raw[:2]...)
	out = append(out, exif...)
	out = append(out, com...)
	return append(out, raw[2:]...)
}

// pngWithText renvoie un PNG valide avec un chunk tEXt inséré après IHDR.
func pngWithText(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, sampleImage()); err != nil {
		t.Fatal(err)
	}
	raw := buf.Bytes()
	data := []byte("Comment\x00GPS 6.3703,2.4253")
	chunk := make([]byte, 8, 12+len(data))
	binary.BigEndian.PutUint32(chunk[:4], uint32(len(data))) //nolint:gosec // petite charge utile de test
	copy(chunk[4:8], "tEXt")
	chunk = append(chunk, data...)
	crc := crc32.ChecksumIEEE(append([]byte("tEXt"), data...))
	chunk = binary.BigEndian.AppendUint32(chunk, crc)
	ihdrEnd := 8 + 12 + 13
	out := append([]byte{}, raw[:ihdrEnd]...)
	out = append(out, chunk...)
	return append(out, raw[ihdrEnd:]...)
}

func TestPrepareDetectsTypeByMagicBytes(t *testing.T) {
	s := newService(t)
	tests := []struct {
		name   string
		data   []byte
		mime   string
		status int
		code   string
	}{
		{"pdf", []byte("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF"), document.MIMEPDF, 0, ""},
		{"jpeg", jpegWithEXIF(t), document.MIMEJPEG, 0, ""},
		{"png", pngWithText(t), document.MIMEPNG, 0, ""},
		{"gif renamed .pdf", []byte("GIF89a\x01\x00\x01\x00\x00\x00\x00;"), "", http.StatusUnsupportedMediaType, document.CodeUnsupportedType},
		{"html", []byte("<!doctype html><script>alert(1)</script>"), "", http.StatusUnsupportedMediaType, document.CodeUnsupportedType},
		{"windows executable", append([]byte("MZ\x90\x00"), make([]byte, 200)...), "", http.StatusUnsupportedMediaType, document.CodeUnsupportedType},
		{"truncated jpeg", []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00}, "", http.StatusUnprocessableEntity, document.CodeInvalidFile},
		{"empty", nil, "", http.StatusUnprocessableEntity, document.CodeInvalidFile},
		{"too large", append([]byte("%PDF-"), make([]byte, 64<<10)...), "", http.StatusRequestEntityTooLarge, document.CodeTooLarge},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p, err := s.Prepare(bytes.NewReader(tt.data))
			if tt.code == "" {
				if err != nil || p.MIME != tt.mime {
					t.Fatalf("Prepare = %q, %v; want %s", p.MIME, err, tt.mime)
				}
				return
			}
			e, ok := apperr.As(err)
			if !ok || e.Status != tt.status || e.Code != tt.code {
				t.Fatalf("Prepare error = %v, want %d %s", err, tt.status, tt.code)
			}
		})
	}
}

func TestMetadataIsStripped(t *testing.T) {
	s := newService(t)
	for name, data := range map[string][]byte{"jpeg": jpegWithEXIF(t), "png": pngWithText(t)} {
		p, err := s.Prepare(bytes.NewReader(data))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		for _, leak := range []string{"GPS", "Exif", "Kofi", "Phone X", "tEXt"} {
			if bytes.Contains(p.Data, []byte(leak)) {
				t.Errorf("%s: metadata %q not stripped", name, leak)
			}
		}
		if _, _, err := image.Decode(bytes.NewReader(p.Data)); err != nil {
			t.Errorf("%s: stripped image no longer decodes: %v", name, err)
		}
	}
}

func TestSaveAndOpenEncrypted(t *testing.T) {
	s := newService(t)
	p, err := s.Prepare(bytes.NewReader([]byte("%PDF-1.4 IFU 3201234567890")))
	if err != nil {
		t.Fatal(err)
	}
	stored, err := s.Save(t.Context(), uuid.New(), p)
	if err != nil {
		t.Fatal(err)
	}
	if stored.MIME != document.MIMEPDF || len(stored.WrappedKey) == 0 || len(stored.SHA256) != 32 {
		t.Fatalf("stored = %+v", stored)
	}
	got, err := s.Open(t.Context(), stored)
	if err != nil || !bytes.Equal(got, p.Data) {
		t.Fatalf("Open = %q, %v", got, err)
	}
	stored.SHA256[0] ^= 1
	if _, err := s.Open(t.Context(), stored); err == nil {
		t.Fatal("integrity mismatch not detected")
	}
}
