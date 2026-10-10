package storage_test

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"gostation/backend/internal/platform/storage"
)

func TestLocalStorage(t *testing.T) {
	root := t.TempDir()
	s, err := storage.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	ctx := t.Context()
	key := "stations/0192/doc-1.bin"
	if err := s.Put(ctx, key, []byte("ciphertext")); err != nil {
		t.Fatal(err)
	}
	got, err := s.Get(ctx, key)
	if err != nil || string(got) != "ciphertext" {
		t.Fatalf("Get = %q, %v", got, err)
	}
	info, err := os.Stat(filepath.Join(root, "stations", "0192", "doc-1.bin"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("file mode = %v, %v; want 0600", info.Mode().Perm(), err)
	}
	if err := s.Delete(ctx, key); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(ctx, key); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("Get after delete = %v, want ErrNotFound", err)
	}
	if err := s.Delete(ctx, key); err != nil {
		t.Fatalf("Delete must be idempotent: %v", err)
	}
}

func TestLocalStorageRejectsUnsafeKeys(t *testing.T) {
	s, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"", "/etc/passwd", "../escape.bin", "a/../../b", "a\\b", "spaces not allowed", "a/b?c"} {
		if err := s.Put(t.Context(), key, []byte("x")); err == nil {
			t.Errorf("Put(%q) accepted", key)
		}
	}
}
