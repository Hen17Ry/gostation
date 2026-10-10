//go:build integration

package auth

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"

	"gostation/backend/internal/ratelimit"
	"gostation/backend/internal/testutil"
)

// testRedis est le Redis du paquet, démarré une fois dans TestMain.
var testRedis *goredis.Client

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

func runTests(m *testing.M) int {
	url, stop, err := testutil.StartRedis(context.Background())
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stop()
	opts, err := goredis.ParseURL(url)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	testRedis = goredis.NewClient(opts)
	defer func() { _ = testRedis.Close() }()
	return m.Run()
}

func TestSessionRotationAndReuseDetection(t *testing.T) {
	ctx := t.Context()
	s := NewSessionStore(testRedis)
	uid := uuid.New()

	sess, rt1, err := s.Create(ctx, Session{UserID: uid, Role: "user", Client: ClientMobile, UserAgent: "GoStation/1.0"}, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if alive, _ := s.Exists(ctx, sess.ID); !alive {
		t.Fatal("new session not found")
	}
	if ttl := testRedis.PTTL(ctx, refreshPrefix+hashToken(rt1)).Val(); ttl <= 59*time.Minute {
		t.Errorf("refresh token TTL = %s, want ~1h", ttl)
	}
	if v := testRedis.Get(ctx, refreshPrefix+rt1).Val(); v != "" {
		t.Fatal("refresh token stored in clear")
	}

	got, rt2, err := s.Rotate(ctx, rt1)
	if err != nil || got.ID != sess.ID || got.UserID != uid || rt2 == rt1 {
		t.Fatalf("Rotate = %+v, %q, %v", got, rt2, err)
	}
	_, rt3, err := s.Rotate(ctx, rt2)
	if err != nil {
		t.Fatal(err)
	}

	// Réutilisation d'un token déjà consommé : toute la session est révoquée.
	if _, _, err := s.Rotate(ctx, rt1); !errors.Is(err, ErrRefreshTokenReused) {
		t.Fatalf("reuse error = %v, want ErrRefreshTokenReused", err)
	}
	if alive, _ := s.Exists(ctx, sess.ID); alive {
		t.Fatal("session still alive after reuse detection")
	}
	if _, _, err := s.Rotate(ctx, rt3); err == nil {
		t.Fatal("latest token of a revoked session still works")
	}
	if _, _, err := s.Rotate(ctx, "gsr_unknown"); !errors.Is(err, ErrInvalidRefreshToken) {
		t.Fatalf("unknown token error = %v", err)
	}
}

func TestSessionListAndRevokeAll(t *testing.T) {
	ctx := t.Context()
	s := NewSessionStore(testRedis)
	uid := uuid.New()
	a, _, _ := s.Create(ctx, Session{UserID: uid, Role: "user", Client: ClientMobile}, time.Hour)
	b, _, _ := s.Create(ctx, Session{UserID: uid, Role: "user", Client: ClientMobile}, time.Hour)
	c, rtC, _ := s.Create(ctx, Session{UserID: uid, Role: "user", Client: ClientWeb}, time.Hour)

	list, err := s.List(ctx, uid)
	if err != nil || len(list) != 3 {
		t.Fatalf("List = %d sessions, %v", len(list), err)
	}
	if err := s.Revoke(ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.RevokeAll(ctx, uid, a.ID); err != nil {
		t.Fatal(err)
	}
	list, _ = s.List(ctx, uid)
	if len(list) != 1 || list[0].ID != a.ID {
		t.Fatalf("after RevokeAll(except a): %+v", list)
	}
	if _, _, err := s.Rotate(ctx, rtC); err == nil {
		t.Fatal("refresh token of a revoked session still works")
	}
	if _, err := s.Get(ctx, c.ID); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("Get(revoked) = %v", err)
	}
}

func TestOTPAttemptsAndResendLimits(t *testing.T) {
	ctx := t.Context()
	otp := NewOTPStore(testRedis, []byte("0123456789abcdef0123456789abcdef"), ratelimit.New(testRedis, ratelimit.WithPrefix("test-otp")))
	uid := uuid.New()

	code, err := otp.Issue(ctx, PurposeVerifyEmail, uid)
	if err != nil || len(code) != 6 {
		t.Fatalf("Issue = %q, %v", code, err)
	}
	if raw := testRedis.HGet(ctx, otpKey(PurposeVerifyEmail, uid), "hash").Val(); raw == code || len(raw) != 64 {
		t.Fatalf("code must be stored as an HMAC, got %q", raw)
	}
	if ttl := testRedis.PTTL(ctx, otpKey(PurposeVerifyEmail, uid)).Val(); ttl <= 14*time.Minute || ttl > OTPTTL {
		t.Errorf("code TTL = %s, want 15 min", ttl)
	}
	// Renvoi immédiat refusé (1/min).
	if _, err := otp.Issue(ctx, PurposeVerifyEmail, uid); !errors.Is(err, ErrResendTooSoon) {
		t.Fatalf("immediate resend: %v, want ErrResendTooSoon", err)
	}
	// Un code d'un autre usage ne valide pas celui-ci.
	if err := otp.Verify(ctx, PurposeResetPassword, uid, code); !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("cross-purpose verify: %v", err)
	}

	wrong := "000000"
	if wrong == code {
		wrong = "111111"
	}
	for i := range OTPMaxAttempts - 1 {
		if err := otp.Verify(ctx, PurposeVerifyEmail, uid, wrong); !errors.Is(err, ErrInvalidCode) {
			t.Fatalf("attempt %d: %v", i+1, err)
		}
	}
	if err := otp.Verify(ctx, PurposeVerifyEmail, uid, code); err != nil {
		t.Fatalf("correct code after 4 failures rejected: %v", err)
	}
	if err := otp.Verify(ctx, PurposeVerifyEmail, uid, code); !errors.Is(err, ErrInvalidCode) {
		t.Fatal("a code must be single-use")
	}

	// 5 échecs : le code est détruit, même le bon ne passe plus.
	testRedis.Del(ctx, "otp:cooldown:"+string(PurposeResetPassword)+":"+uid.String())
	code, _ = otp.Issue(ctx, PurposeResetPassword, uid)
	for range OTPMaxAttempts {
		_ = otp.Verify(ctx, PurposeResetPassword, uid, "999999")
	}
	if code != "999999" {
		if err := otp.Verify(ctx, PurposeResetPassword, uid, code); !errors.Is(err, ErrInvalidCode) {
			t.Fatal("code still valid after 5 failed attempts")
		}
	}

	// Limite horaire : 5 envois par heure (on lève le délai d'une minute entre chaque).
	other := uuid.New()
	for i := range OTPResendPerHour {
		testRedis.Del(ctx, "otp:cooldown:"+string(PurposeVerifyEmail)+":"+other.String())
		if _, err := otp.Issue(ctx, PurposeVerifyEmail, other); err != nil {
			t.Fatalf("issue %d: %v", i+1, err)
		}
	}
	testRedis.Del(ctx, "otp:cooldown:"+string(PurposeVerifyEmail)+":"+other.String())
	if _, err := otp.Issue(ctx, PurposeVerifyEmail, other); !errors.Is(err, ErrResendExhausted) {
		t.Fatalf("6th code in an hour: %v, want ErrResendExhausted", err)
	}
}

func TestMFAChallengeAndTOTPReplay(t *testing.T) {
	ctx := t.Context()
	m := NewMFAStore(testRedis)
	uid := uuid.New()

	token, err := m.Start(ctx, uid, []byte("sealed-secret"))
	if err != nil {
		t.Fatal(err)
	}
	ch, err := m.Get(ctx, token)
	if err != nil || ch.UserID != uid || string(ch.PendingSecret) != "sealed-secret" {
		t.Fatalf("Get = %+v, %v", ch, err)
	}
	for range MFAMaxAttempts {
		_ = m.Fail(ctx, token)
	}
	if _, err := m.Get(ctx, token); !errors.Is(err, ErrInvalidMFAToken) {
		t.Fatalf("challenge alive after %d failures: %v", MFAMaxAttempts, err)
	}

	if ok, _ := m.AcceptTOTPStep(ctx, uid, 1000); !ok {
		t.Fatal("first use of a step rejected")
	}
	for _, step := range []int64{1000, 999} {
		if ok, _ := m.AcceptTOTPStep(ctx, uid, step); ok {
			t.Fatalf("step %d replayed", step)
		}
	}
	if ok, _ := m.AcceptTOTPStep(ctx, uid, 1001); !ok {
		t.Fatal("next step rejected")
	}
}
