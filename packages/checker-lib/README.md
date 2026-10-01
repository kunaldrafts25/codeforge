# @codeforge/checker-lib

Bounded trusted exact, ASCII whitespace token, and finite numeric comparison.
Jury values remain outside candidate execution. Malformed jury output or policy
raises CheckerFailure and must become JUDGE_FAILURE. Custom checker execution
is unsupported. Unit checks do not establish judge isolation or compiler correctness.
