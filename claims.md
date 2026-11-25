# Claim ledger

Every number or fact shown on the page, the README, the printed card or said at the table, that this repo does not compute.
`check_numbers.py` fails on any row whose "read in full?" is not `yes`. Change a row to `yes`
only after you have read the source yourself. Computed numbers (shielding ratio, rescue rates,
balance points, mutation and SBC results) never appear here: they come from `oracle.json` or
`reports/`.

Sources:
- [M25] Morita, Nie & Takeuchi, "Tetanus-driven biohybrid multijoint robots powered by muscle
  rings with enhanced contractile force", Science Advances 2025, doi:10.1126/sciadv.adu9962,
  PMC12266100, CC BY-NC 4.0.
- [D25] Dryad dataset for [M25], doi:10.5061/dryad.zpc866tjq, CC0.
- [Z19] Zhang et al., Nature Communications 2019, doi:10.1038/s41467-019-12759-5.

| id | claim | value | source | read in full? | checked by |
| --- | --- | --- | --- | --- | --- |
| C1 | Joints of the slither-type robot rotate about 5 to 10 degrees; snake joints 20 to 50 | 5-10 deg; 20-50 deg | [M25] Discussion | to confirm | Claude 25 Nov, via a web-fetch summary: verify |
| C2 | The opposing stack's extension limits rotation | - | [M25] Discussion | to confirm | Claude 23 Nov |
| C3 | Field leakage to the non-target stack is about 1/12 of the applied field with shielding, about 1/2.9 without (simulation) | 1/12; 1/2.9 | [M25] Results, antagonistic actuators | to confirm | Claude 25 Nov, via a web-fetch summary: verify |
| C4 | With shielding, the measured rotation angle was about twice that without | about 2x | [M25] Results | to confirm | Claude 25 Nov, via a web-fetch summary: verify |
| C5 | Rings are taken out after 14 to 16 days of culture | 14-16 days | [M25] Methods | to confirm | Claude 22 Nov |
| C6 | Force of a stack increased proportionally with the number of rings (about 1.7 to 3.7, 4.4 and 5.9 mN, n = 3) | 1.7; 3.7; 4.4; 5.9 mN; n = 3 | [M25] Results, Fig. 6G | to confirm | Claude 23 Nov |
| C7 | One ring pulls about 2 mN | about 2 mN | [M25] Fig. 6G (about 1.7 mN per ring in stacks); [D25] single rings 1.87-2.40 mN | to confirm | Claude 23 Nov |
| C8 | Active force peaks near 26 % strain; strain kept below 37 % | 26 %; 37 % | [M25] Results, Fig. 2 | to confirm | Claude 23 Nov |
| C9 | Anchors moved from 2 mm to 4 mm, about 24 % strain or less | 24 % | [M25] Results | to confirm | Claude 22 Nov |
| C11 | Fig. 2F: ring stained for F-actin (green), alpha-actinin (red), nuclei (blue); scale bar 20 um | 20 um | [M25] Fig. 2F legend | to confirm | Claude 25 Nov, via a web-fetch summary: verify |
| C12 | Movie S11: antagonistic actuator; the tip rotates toward the stimulated side. No angle is given | - | [M25] Fig. 6D and supplementary legend | to confirm (check the PDF legend) | Claude 25 Nov |
| C13 | The design tools I reviewed drive the muscle with a fixed force (Zhang 2019: prescribed contractile stress) | - | [Z19] Methods; Balciunaite 2026; Castro 2026 | to confirm | Claude 23 Nov |
| C15 | A "neutral" half-normal prior with equal scales gives Pr(omega > 0.5) of about 70 % with no data | 0.705 | derivation: 1 - (2/pi) arctan(1/2) | to confirm (rerun) | Claude 23 Nov |
| C16 | A 6-of-9 pass rule passes a model whose 90 % bounds hold 70 % of the time with probability 0.73 (independent cases) | 0.73; 0.99 at 90 %; 0.25 at 50 % | derivation: binomial | to confirm (rerun) | Claude 23 Nov |
| C17 | Four independent parts each at 90 % give 66 % | 0.656 | derivation: 0.9^4 | to confirm (rerun) | Claude 23 Nov |
| L1 | Licence of [M25], its movies and figures | CC BY-NC 4.0 | [M25] article page | to confirm | Claude 25 Nov |
| L2 | Licence of [D25] | CC0 | [D25] Dryad page | to confirm | Claude 22 Nov |

## Incidents (shown on the laptop, no numbers)
- I1: During literature research, a summarising web-fetch tool returned claims about prior papers
  that no source supported. Fix: this ledger; every row needs a source read in full.
- I2: An early talk draft said "four rings give 0.84 of four times one ring". The paper reports
  proportional growth with n = 3 per count (C6), so the claim was dropped.
