# pino-roll-size-units

## Summary
A size-based rotation test with pino-roll appears not to work because a size value
without a unit is read as MB, not bytes.

## Context
Configuring pino-roll for size rotation and passing a small value to force a quick
roll (e.g. `size: 600` or `size: '600'`) while writing a payload of a few KB. The
file keeps growing and never rotates, which looks like a broken library. The same
misreading led to discarding pino-roll and writing a custom rotating stream that
duplicated what the library already does.

## Solution
pino-roll `size` accepts only `k`, `m` and `g` units. A bare number or numeric
string is interpreted as **MB**:

- `size: 600` or `size: '600'` -> 600 MB (never rotates on a small probe)
- `size: '600k'` -> 600 KB
- `size: '1m'` -> 1 MB

For a quick rotation test use an explicit unit such as `size: '1k'` and write
enough data to exceed it. Two further points verified while diagnosing:

- Rotation is checked between writes, so the resulting file can be slightly larger
  than the ceiling; it is not byte-exact.
- `pino(roll(options))` (calling the export directly as a stream) does not attach
  correctly: records go to stdout and the file stays empty. Use the documented
  transport form `pino.transport({ target: 'pino-roll', options })`.
- `limit` requires `limit.count`; passing only `removeOtherLogFiles` throws
  `limit.count must be a number greater than 0`. Omit `limit` entirely when
  retention is handled by age (pino-roll only prunes by file count).

Our config normalizes `LOG_MAX_FILE_SIZE` to this syntax and defaults to `100m`.

## Tags
<pino> <logging> <windows> <rotation> <pino-roll>