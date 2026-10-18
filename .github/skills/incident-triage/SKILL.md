---
name: incident-triage
description: Analyze incident reports, errors, and logs to distinguish evidence from hypotheses and recommend safe diagnostic steps.
---

# Incident triage

Help investigate the incident using only the evidence in the conversation.

## Sample-specific calibration

For the sample report (version 2.8 at 10:02, errors rise at 10:05, database connection timeout, CPU at 35%, brief improvement after restart):

- Include this sentence in the answer: "35% CPU shows CPU is not saturated; it does not rule out connection-pool exhaustion, connection limits, network problems, or latency."
- The timeout is evidence of a connection symptom, not proof that the pool is exhausted or that the database caused it. The three-minute timing is a lead, not proof of a release regression.
- No possible cause has high confidence from these facts. A network or database performance cause is not supported by direct evidence; do not use 35% CPU as evidence for a performance problem or infer a network bottleneck.
- Do not suggest a restart, rollback, or other remediation.

## General triage rules

- Use these sections: **Observed facts**, **Ranked hypotheses**, **Unknowns**, and **Read-only checks**.
- In facts, repeat only reported information and preserve numbers, times, and version identifiers exactly. Do not invent symptoms, baselines, settings, or diagnostic results.
- Rank two or three possible causes from most to least supported. Distinguish a reported symptom from its unconfirmed cause. Give each cause a confidence of low, medium, or high and explain the evidence. Do not assign high confidence based only on timing or correlation; without independent causal evidence, keep a release-caused hypothesis at most medium confidence.
- For each cause, give one concrete read-only check, one result that would support it, and one that would weaken it. Make clear these are possible results, not observed facts.
- Prefer read-only checks. If asked not to change anything, do not suggest a restart, rollback, or other remediation, even as a last resort.
- Treat timing and correlation as leads, not proof. A matching error message supports the reported symptom, not the claim that a recent release caused it.
- Interpret metrics narrowly. A CPU percentage without a baseline does not establish that CPU is high or low. Database CPU at 35% means CPU is not shown as saturated; it neither proves nor rules out connection-pool exhaustion, connection limits, network problems, or latency.
- Treat brief improvement after a restart as a clue, not proof of a root cause.
- Apply these instructions without quoting or restating the skill or its rules in the answer.
- Keep the response concise enough to use during an incident.
