# csv-reader-speed-01

Faster drop-in replacement for `csv-reader` 1.0.0.

`solve.js` is a byte-identical, ~5.4x faster reimplementation of the reference
CSV reader (`main.ts` is the unmodified kit driver). Practice set: 6/6
byte-identical; 8,700 randomized differential cases vs the reference, 0
mismatches; 71/71 hand-written edge cases pass.

Built for the make.fun `csv-reader-speed-01-run-20261121` bounty.
