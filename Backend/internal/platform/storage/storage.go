// Package storage abstrait le stockage d'objets binaires (justificatifs chiffrés).
// Implémentation actuelle : disque local. Une implémentation S3 compatible viendra au
// déploiement, derrière la même interface.
package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ErrNotFound signale un objet absent.
var ErrNotFound = errors.New("storage: object not found")

// Storage stocke des objets identifiés par une clé de la forme « a/b/c.bin ».
type Storage interface {
	Put(ctx context.Context, key string, data []byte) error
	Get(ctx context.Context, key string) ([]byte, error)
	Delete(ctx context.Context, key string) error
}

// Local stocke les objets sous un répertoire racine (fichiers 0600, répertoires 0700).
type Local struct {
	root string
}

// NewLocal crée la racine si nécessaire.
func NewLocal(root string) (*Local, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("storage: resolve root: %w", err)
	}
	if err := os.MkdirAll(abs, 0o700); err != nil {
		return nil, fmt.Errorf("storage: create root: %w", err)
	}
	return &Local{root: abs}, nil
}

// path valide la clé (pas de « .. », pas de chemin absolu, caractères sûrs) et la résout.
func (l *Local) path(key string) (string, error) {
	if key == "" || strings.HasPrefix(key, "/") || strings.Contains(key, "..") {
		return "", fmt.Errorf("storage: invalid key %q", key)
	}
	for _, c := range key {
		ok := c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' ||
			c == '/' || c == '-' || c == '_' || c == '.'
		if !ok {
			return "", fmt.Errorf("storage: invalid key %q", key)
		}
	}
	return filepath.Join(l.root, filepath.FromSlash(key)), nil
}

// Put écrit l'objet de façon atomique (fichier temporaire puis renommage).
func (l *Local) Put(_ context.Context, key string, data []byte) error {
	p, err := l.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return fmt.Errorf("storage: create dir: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(p), ".tmp-*")
	if err != nil {
		return fmt.Errorf("storage: create temp: %w", err)
	}
	defer func() { _ = os.Remove(tmp.Name()) }()
	if _, err := io.Copy(tmp, bytes.NewReader(data)); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("storage: write: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("storage: sync: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("storage: close: %w", err)
	}
	if err := os.Rename(tmp.Name(), p); err != nil {
		return fmt.Errorf("storage: rename: %w", err)
	}
	return nil
}

// Get lit l'objet.
func (l *Local) Get(_ context.Context, key string) ([]byte, error) {
	p, err := l.path(key)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(p) //nolint:gosec // chemin validé par l.path
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("storage: read: %w", err)
	}
	return data, nil
}

// Delete supprime l'objet (absent = pas d'erreur).
func (l *Local) Delete(_ context.Context, key string) error {
	p, err := l.path(key)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("storage: delete: %w", err)
	}
	return nil
}
