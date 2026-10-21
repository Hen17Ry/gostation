package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// S3Config décrit un stockage objet compatible S3 (n'importe quel fournisseur : AWS, Scaleway,
// OVHcloud, Backblaze, Cloudflare R2, MinIO, SeaweedFS…).
type S3Config struct {
	// Endpoint : hôte[:port], sans schéma (s3.fr-par.scw.cloud).
	Endpoint  string
	Region    string
	Bucket    string
	AccessKey string
	SecretKey string
	// TLS : HTTPS vers le fournisseur (obligatoire en production).
	TLS bool
	// PathStyle force les URL https://hôte/bucket/clé (MinIO, SeaweedFS, certains fournisseurs).
	PathStyle bool
	// Prefix est ajouté devant chaque clé (plusieurs environnements dans un même bucket).
	Prefix string
}

// S3 stocke les objets dans un bucket. Les objets sont déjà chiffrés par l'application
// (enveloppe AES-256-GCM) : le fournisseur ne voit jamais un justificatif en clair.
type S3 struct {
	client *minio.Client
	bucket string
	prefix string
}

// NewS3 se connecte et vérifie que le bucket existe (il n'est jamais créé ici : ses droits et sa
// politique de cycle de vie relèvent du fournisseur, docs/DEPLOY.md).
func NewS3(ctx context.Context, cfg S3Config) (*S3, error) {
	lookup := minio.BucketLookupAuto
	if cfg.PathStyle {
		lookup = minio.BucketLookupPath
	}
	client, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:        credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure:       cfg.TLS,
		Region:       cfg.Region,
		BucketLookup: lookup,
	})
	if err != nil {
		return nil, fmt.Errorf("storage: s3 client: %w", err)
	}
	ok, err := client.BucketExists(ctx, cfg.Bucket)
	if err != nil {
		return nil, fmt.Errorf("storage: s3 bucket %q: %w", cfg.Bucket, err)
	}
	if !ok {
		return nil, fmt.Errorf("storage: s3 bucket %q does not exist", cfg.Bucket)
	}
	prefix := strings.Trim(cfg.Prefix, "/")
	if prefix != "" {
		prefix += "/"
	}
	return &S3{client: client, bucket: cfg.Bucket, prefix: prefix}, nil
}

func (s *S3) object(key string) (string, error) {
	if err := validKey(key); err != nil {
		return "", err
	}
	return s.prefix + key, nil
}

// Put écrit l'objet (remplace un objet existant).
func (s *S3) Put(ctx context.Context, key string, data []byte) error {
	name, err := s.object(key)
	if err != nil {
		return err
	}
	_, err = s.client.PutObject(ctx, s.bucket, name, bytes.NewReader(data), int64(len(data)),
		minio.PutObjectOptions{ContentType: "application/octet-stream"})
	if err != nil {
		return fmt.Errorf("storage: s3 put: %w", err)
	}
	return nil
}

// Get lit l'objet.
func (s *S3) Get(ctx context.Context, key string) ([]byte, error) {
	name, err := s.object(key)
	if err != nil {
		return nil, err
	}
	obj, err := s.client.GetObject(ctx, s.bucket, name, minio.GetObjectOptions{})
	if err != nil {
		return nil, s.readErr(err)
	}
	defer func() { _ = obj.Close() }()
	data, err := io.ReadAll(obj)
	if err != nil {
		return nil, s.readErr(err)
	}
	return data, nil
}

func (s *S3) readErr(err error) error {
	var resp minio.ErrorResponse
	if errors.As(err, &resp) && (resp.Code == minio.NoSuchKey || resp.StatusCode == http.StatusNotFound) {
		return ErrNotFound
	}
	return fmt.Errorf("storage: s3 get: %w", err)
}

// Delete supprime l'objet (absent = pas d'erreur).
func (s *S3) Delete(ctx context.Context, key string) error {
	name, err := s.object(key)
	if err != nil {
		return err
	}
	if err := s.client.RemoveObject(ctx, s.bucket, name, minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("storage: s3 delete: %w", err)
	}
	return nil
}

// Ping vérifie que le bucket répond (sonde /readyz).
func (s *S3) Ping(ctx context.Context) error {
	if _, err := s.client.BucketExists(ctx, s.bucket); err != nil {
		return fmt.Errorf("storage: s3 ping: %w", err)
	}
	return nil
}
