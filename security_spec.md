# Security Specification - Nifty Backtest Pro

## 1. Data Invariants
- `OHLCBar`: Must have a valid `datasetId`. Date-time must be a valid ISO string. Values must be positive numbers.
- `Strategy`: `userId` must match the authenticated user. `candleType` must be one of the allowed enums.

## 2. The "Dirty Dozen" Payloads (Denial Tests)

### OHLCBar
1. **Unauthorized Write**: Try to write to `ohlc_data` without being logged in.
2. **Schema Poisoning**: Attempt to write a bar with a 1MB string in `datasetId`.
3. **Identity Spoofing**: Setting `userId` on a strategy to another user's ID.
4. **Invalid Type**: Setting `open` price as a boolean.
5. **Missing Required**: Strategy without a `name`.
6. **Enum Violation**: Setting `candleType` to "MAGIC_BARS".

### Strategy
7. **Cross-User Read**: User B trying to read User A's strategy.
8. **Malicious Update**: User B trying to update User A's strategy `initialCapital`.
9. **Shadow Field**: Strategy update including `isVerified: true`.
10. **Resource Exhaustion**: Creating a strategy with a name that is 100KB long.
11. **Negative Capital**: Setting `initialCapital` to -1000.
12. **Status Bypass**: If we had a "terminal" state (none yet), attempting to revert it.

## 3. Test Runner (Draft)
```typescript
// firestore.rules.test.ts (Logic summary)
// Test 1: anon write to ohlc_data -> expect fail
// Test 2: User A writes strategy with User B's ID -> expect fail
// Test 3: User A reads User B's private strategy -> expect fail
// Test 4: User A updates strategy name with invalid length -> expect fail
```
