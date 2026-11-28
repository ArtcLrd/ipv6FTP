package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type RedisCacheRepo struct {
	client *redis.Client
}

func NewRedisClient(ctx context.Context, addr, password string, db int) (*redis.Client, error) {
	client := redis.NewClient(&redis.Options{
		Addr:         addr,
		Password:     password,
		DB:           db,
		DialTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
		PoolSize:     20,
		MinIdleConns: 2,
	})
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("redis ping failed: %w", err)
	}
	return client, nil
}

func NewRedisCacheRepo(client *redis.Client) *RedisCacheRepo {
	return &RedisCacheRepo{client: client}
}

func (r *RedisCacheRepo) Set(ctx context.Context, key string, value any, ttl time.Duration) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return r.client.Set(ctx, key, encoded, ttl).Err()
}

func (r *RedisCacheRepo) GetString(ctx context.Context, key string) (string, bool, error) {
	value, err := r.client.Get(ctx, key).Result()
	if err == redis.Nil {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return value, true, nil
}

func (r *RedisCacheRepo) Delete(ctx context.Context, key string) error {
	return r.client.Del(ctx, key).Err()
}

func (r *RedisCacheRepo) Increment(ctx context.Context, key string, ttl time.Duration) (int64, error) {
	pipe := r.client.TxPipeline()
	counter := pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, ttl)
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, err
	}
	return counter.Val(), nil
}

func (r *RedisCacheRepo) SetBool(ctx context.Context, key string, value bool) error {
	if value {
		return r.client.Set(ctx, key, "1", 0).Err()
	}
	return r.client.Set(ctx, key, "0", 0).Err()
}

func (r *RedisCacheRepo) GetBool(ctx context.Context, key string) (bool, bool, error) {
	value, err := r.client.Get(ctx, key).Result()
	if err == redis.Nil {
		return false, false, nil
	}
	if err != nil {
		return false, false, err
	}
	return value == "1" || value == "true", true, nil
}
