### Run

```
npm install
docker-compose run main
```

### Result

(Mb Air M1 2020)

```
prepare_keys: 7.356s
prep_access_logs: 1:42.590 (m:ss.mmm)
dry_run_reqwarmup: 29.008s
dry_run_reqmeasure: 28.738s
prep_redis: 5.235s
redis_run_reqwarmup: 36.437s
dry_run_reqmeasure: 4.035s
redis_run_reqmeasure: 25.942s
pg_prepare: 2:00.346 (m:ss.mmm)
pg_run_reqwarmup: 1:32.846 (m:ss.mmm)
dry_run_reqmeasure: 4.044s
pg_run_reqmeasure: 1:32.312 (m:ss.mmm)
```
