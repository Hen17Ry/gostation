package jobs

import (
	"errors"
	"testing"
	"time"

	"github.com/hibiken/asynq"
)

func TestRetryDelayIsExponentialAndCapped(t *testing.T) {
	delay := RetryDelay(10*time.Second, time.Hour)
	for n, base := range []time.Duration{10 * time.Second, 20 * time.Second, 40 * time.Second, 80 * time.Second} {
		for range 50 {
			d := delay(n, nil, nil)
			if d < base*3/4 || d > base*5/4 {
				t.Fatalf("retry %d: delay %s outside %s ± 25 %%", n, d, base)
			}
		}
	}
	for range 50 {
		if d := delay(30, nil, nil); d < 45*time.Minute || d > 75*time.Minute {
			t.Fatalf("retry 30: delay %s, want about the 1 h cap", d)
		}
	}
}

func TestDecodeRejectsGarbageWithoutRetry(t *testing.T) {
	_, err := Decode[PushPayload](asynq.NewTask(TypePushSend, []byte("{not json")))
	if err == nil || !errors.Is(err, asynq.SkipRetry) {
		t.Fatalf("err = %v, want SkipRetry", err)
	}
	p, err := Decode[BackInStockPayload](asynq.NewTask(TypeBackInStock, []byte(`{"s":"01a1290a-4426-7843-83d2-1af8dacda1aa","p":[3,4]}`)))
	if err != nil || len(p.ProductIDs) != 2 || p.StationID.String() != "01a1290a-4426-7843-83d2-1af8dacda1aa" {
		t.Fatalf("decode = %+v, %v", p, err)
	}
}
