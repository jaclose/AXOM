---
tags:
  - axom/feature
  - axom/simulation
authority: canonical
---
# Body simulator: first study slice

The first local slice models one **qualitative** scenario: airway changes in asthma
and the action of inhaled albuterol. The body map lets a learner inspect airways,
heart and hands. The heart and hands show possible adverse effects, not outcomes
predicted for an individual. It has no dose, clock, severity score, patient record,
or inferred risk. This is a mechanism study surface, not diagnosis or treatment.

The app's `#simulations` route and sidebar entry are integrated separately. The
page implementation is `web/src/pages/BodySimulatorPage.tsx`; its typed evidence
and observation data are in `web/src/lib/simulator/asthmaScenario.ts`. A new
scenario should arrive with a claim-to-source audit and clinical review before it
is called complete. A stylized original SVG is used for orientation; it is not
an anatomical or pharmacokinetic measurement.

## Claim ledger

| Displayed claim | Evidence |
| --- | --- |
| Asthma can inflame and narrow the airways | [NHLBI, What Is Asthma?](https://www.nhlbi.nih.gov/health/asthma) |
| Airway muscle can tighten and mucus can increase | [NHLBI, Causes and Triggers](https://www.nhlbi.nih.gov/health/asthma/causes) |
| Quick-relief bronchodilators relax airway muscle | [MedlinePlus, Asthma quick-relief drugs](https://medlineplus.gov/ency/patientinstructions/000008.htm) |
| Inhaled albuterol opens air passages and controls symptoms without curing asthma | [MedlinePlus, Albuterol oral inhalation](https://medlineplus.gov/druginfo/meds/a682145.html) |
| Shaking and fast, pounding or irregular heartbeat are possible adverse effects | [MedlinePlus, Albuterol oral inhalation](https://medlineplus.gov/druginfo/meds/a682145.html) |

The airway cross-section changes size to communicate the mechanism. Its sizes are
deliberately unlabeled and are not quantitative. The source links stay visible
beside each medical observation, including the model boundary. Content is
awaiting human medical review before being presented as a validated clinical
teaching module.
