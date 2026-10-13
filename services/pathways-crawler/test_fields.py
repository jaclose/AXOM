"""Field routing regressions; synthetic passages only."""
import unittest
import crawler as c

class FieldRoutingTests(unittest.TestCase):
    def test_admission_is_not_mission(self):
        page={"title":"Fixture", "blocks":["Admission requirements apply to applicants in the early decision program."], "links":[]}
        self.assertNotIn("mission_contacts.mission_values", [p["field"] for p in c.proposals("medical-schools",page)])
    def test_explicit_mission_is_candidate(self):
        page={"title":"Fixture", "blocks":["Our mission is to prepare students for a lifetime of service and inquiry."], "links":[]}
        self.assertIn("mission_contacts.mission_values", [p["field"] for p in c.proposals("medical-schools",page)])
