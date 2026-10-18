import unittest
from unittest.mock import Mock, patch

import incident_triage_agent


class SelectionTests(unittest.TestCase):
    def test_sample_context_selects_skill_without_naming_it(self):
        context = "Our checkout service has been unreliable since this morning's release."
        prompt = (
            'At 10:02 we deployed version 2.8. At 10:05, HTTP 500s rose from 0.2% to 12%. '
            'Logs include "database connection timeout."'
        )
        self.assertEqual(
            incident_triage_agent.matching_terms(context + " " + prompt),
            ["checkout", "unreliable", "deploy", "http 500", "500s", "timeout", "database connection", "logs"],
        )

    def test_unrelated_prompt_does_not_match(self):
        self.assertEqual(incident_triage_agent.matching_terms("Explain how photosynthesis works."), [])

    def test_skill_metadata_and_instructions_are_read_from_file(self):
        name, description, body = incident_triage_agent.read_skill()
        self.assertEqual(name, "incident-triage")
        self.assertIn("incident reports", description)
        self.assertIn("Use these sections: **Observed facts**", body)
        self.assertIn("repeat only reported information", body)
        self.assertIn("most to least supported", body)
        self.assertIn("neither proves nor rules out connection-pool exhaustion", body)
        self.assertIn("Do not assign high confidence based only on timing", body)
        self.assertIn("keep a release-caused hypothesis at most medium confidence", body)
        self.assertIn("preserve numbers, times, and version identifiers exactly", body)
        self.assertIn("do not suggest a restart, rollback, or other remediation", body)
        self.assertIn("connection-pool exhaustion, connection limits, network problems, or latency", body)
        self.assertIn("one result that would support it, and one that would weaken it", body)


class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        incident_triage_agent._runtimes.clear()

    async def test_skill_mode_emits_actual_selection_and_load_trace(self):
        async def response_stream(*args, **kwargs):
            yield Mock(text="Investigate the timeout.")

        fake_agent = Mock()
        fake_agent.create_session.return_value = object()
        fake_agent.run = Mock(side_effect=response_stream)
        events = []
        with patch.object(incident_triage_agent, "Agent", return_value=fake_agent) as make_agent, patch.object(
            incident_triage_agent, "OllamaChatClient"
        ):
            reply = "".join([
                text async for text in incident_triage_agent.chat(
                    "Checkout is unreliable after the deployment; investigate the timeout.",
                    "skill",
                    events.append,
                )
            ])
        self.assertIn("matched", [event["status"] for event in events])
        load_event = next(event for event in events if event["kind"] == "load")
        self.assertEqual(load_event["status"], "loaded")
        self.assertEqual(load_event["path"], ".github/skills/incident-triage/SKILL.md")
        self.assertIn("Investigate the timeout.", reply)
        self.assertIn("repeat only reported information", make_agent.call_args.kwargs["instructions"])

    async def test_baseline_has_no_skill_candidate_or_skill_instructions(self):
        async def response_stream(*args, **kwargs):
            yield Mock(text="Check the logs.")

        fake_agent = Mock()
        fake_agent.create_session.return_value = object()
        fake_agent.run = Mock(side_effect=response_stream)
        events = []
        with patch.object(incident_triage_agent, "Agent", return_value=fake_agent) as make_agent, patch.object(
            incident_triage_agent, "OllamaChatClient"
        ), patch.object(incident_triage_agent, "read_skill", side_effect=AssertionError("baseline loaded skill")):
            reply = "".join([text async for text in incident_triage_agent.chat(
                "Checkout is unreliable after the deployment.",
                "baseline",
                events.append,
            )])
        self.assertEqual(events[0]["status"], "unavailable")
        self.assertIn("Check the logs.", reply)
        self.assertNotIn("repeat only reported information", make_agent.call_args.kwargs["instructions"])


if __name__ == "__main__":
    unittest.main()
