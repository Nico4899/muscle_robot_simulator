# Claim ledger

Every number or fact shown on the page, the README, the printed card or said at the table, that this repo does not compute.
`check_numbers.py` fails on any row whose "read in full?" is not `yes`. Rows C15-C17 are
derivations rerun in Python, so they are `yes`. On 25 Nov, at the author's request, Claude
checked the other `yes` rows against full texts the author attached (named in each row); on 26 Nov
also against the full M25 PDF, both Dryad READMEs and the files 2D, 2N and S12B. Change a row to `yes`
only after you have read the source yourself. Computed numbers (shielding ratio, rescue rates,
balance points, mutation and SBC results) never appear here: they come from `oracle.json` or
`reports/`.

Sources:
- [M25] Morita, Nie & Takeuchi, "Tetanus-driven biohybrid multijoint robots powered by muscle
  rings with enhanced contractile force", Science Advances 2025, doi:10.1126/sciadv.adu9962,
  PMC12266100, CC BY-NC 4.0.
- [D25] "Tetanus-driven biohybrid multi-joint robots powered by muscle rings with enhanced contractile
  force", Dryad, doi:10.5061/dryad.zpc866tjq (licence: see L2).
- [Z19] Zhang et al., Nature Communications 2019, doi:10.1038/s41467-019-12759-5.

| id | claim | value | source | read in full? | checked by |
| --- | --- | --- | --- | --- | --- |
| C1 | Joints of the slither-type robot rotate about 5 to 10 degrees; snake joints 20 to 50 during undulatory locomotion | 5-10 deg; 20-50 deg | [M25] Discussion | yes | Claude 26 Nov, against the full M25 PDF: verbatim ("~5° to 10°"; "20° to 50°"). Not cited on the page |
| C2 | In the slither-type robot, extension of the antagonistic stack affects the agonistic side and restricts the joints' rotation | - | [M25] Discussion | yes | Claude 26 Nov, against the full M25 PDF: verbatim |
| C3 | In finite element simulations of the antagonistic unit actuator with and without the shielding structure (fig. S7; a pair of electrodes 2 mm from each muscle ring stack, 4 mm between the two pairs), shielding lowers field leakage to non-target stacks to about 1/12 of the applied field, versus 1/2.9 without | 1/12; 1/2.9 | [M25] Results, antagonistic unit actuators | yes | Claude 25 Nov, against the attached text: holds; simulation, not measurement. Corrected: the Results put it in the antagonistic actuator section and say finite element method, not COMSOL or the slither robot. Fig. S7 itself not seen |
| C4 | Measured: with the shielding structure the average rotation angle was about twice as large (12.4 vs 5.8 deg) | about 2x | [M25] Results, Fig. 6H(c); [D25] file 6H(c) | yes | Claude 25-26 Nov: Results text ("approximately twice as large"), Dryad file 6H(c) (means 12.42 and 5.836). The Fig. 6H legend names unit actuators, the Dryad README slither-type robots: say "the lab's antagonistic joints" |
| C5 | After 14 to 16 days of culture the rings are removed from the mold | 14-16 days | [M25] Results | yes | Claude 25 Nov, against the attached text: verbatim |
| C6 | Average contractile force increased proportionally with the number of rings, from about 1.7 mN (one ring) to 3.7, 4.4 and 5.9 mN; mean +- SEM, n = 3 | 1.7; 3.7; 4.4; 5.9 mN; n = 3 | [M25] Results, Fig. 6G | yes | Claude 25 Nov, against the attached text: verbatim; n = 3 from the Fig. 6G legend |
| C7 | One ring pulls about 2 mN | about 2 mN | [M25] Results: Fig. 6G (about 1.7 mN, single ring), Fig. 2K (2.1 mN), Fig. 2I-J (up to 2.6 mN); [D25] file 2D (mean peak 2.40 mN, n = 4) | yes | Claude 25-26 Nov: Results text and Dryad file 2D |
| C8 | Active tension peaks at 26 % passive strain; passive tension dominates at 37 % or more | 26 %; 37 % | [M25] Results, Fig. 2D; Methods | yes | Claude 25-26 Nov: verbatim. The Methods add: "preferable to operate at tensile strains of 37 % or less" |
| C9 | Anchors first at 2 mm spacing, then adjusted to 4 mm (24 % strain) or less | 2 mm; 4 mm; 24 % | [M25] Methods, slither-type robot | yes | Claude 26 Nov, against the full M25 PDF: verbatim |
| C11 | Fig. 2F: immunostaining; legend lists green F-actin, red alpha-actinin, blue nuclei; scale bar 20 um. The magnified insets show red and blue only | 20 um | [M25] Fig. 2 legend and image; Methods, Immunostaining | yes | Claude 26 Nov, against the full M25 PDF: legend verbatim; the insets show red and blue at the PDF's resolution, and the Methods describe only alpha-actinin and Hoechst (nuclei) staining, no F-actin stain. Do not mention green in the card caption |
| C12 | Movie S11 shows the antagonistic biohybrid unit actuator: the tip rotates toward the stimulated side as the joint turns. The Results give no angle for the movie | - | [M25] Results, Fig. 6D | yes | Claude 25 Nov, against the attached text. The movie's legend title is in the supplement, not attached |
| C14 | Force = peak-to-peak voltage x sensitivity coefficient 10.8 mN/V (sensor calibration in fig. S14) | 10.8 mN/V | [D25] README, file 2D, file 2N; [M25] Methods, fig. S14 | yes | Claude 26 Nov: README ("multiplying Vpp by the sensitivity coefficient 10.8"), files 2D and 2N (0.202 V x 10.8 = 2.1816 mN as listed), Methods (calibration, fig. S14) |
| C18 | Movie S12 shows the slither-type multijoint robot with its muscle ring stacks stimulated sequentially at 1-s intervals | 1 s | [M25] Results, Fig. 7D | yes | Claude 25 Nov, against the attached text. The movie's legend title is in the supplement, not attached |
| C19 | The antagonistic unit actuator turns on average 6.2 to 10.5 deg as stimulation lengthens from 100 to 1000 ms (single values 1.9 to 17.0 deg) | 6.2-10.5 deg | [M25] Fig. 6E; [D25] file 6E (n = 4) | yes | Claude 25 Nov, against the attached text and Dryad file 6E: means 6.204 to 10.502 at 100 to 1000 ms, singles 1.901 to 16.989; 20-Hz tetanus; each value is the average of left and right rotation |
| C20 | Mean active and passive force of 4 single rings against strain (0 to 106 %): active 1.87 mN at 0 %, 2.39-2.40 mN at 26.5-37.9 %, 1.07 mN at 106 %; passive 0.57 mN at 0 %, 2.90 mN at 37.9 %, 10.34 mN at 106 % | see values | [D25] file 2D (Summary columns), [M25] Fig. 2D | yes | Claude 26 Nov: means recomputed from the four rings in file 2D match the Summary column to 2 decimals, except passive at 83.21 %: 7.58 from the rings, 7.61 in the Summary (likely a swapped digit; spec 01 uses the Summary). Strains rounded to 0.1 % |
| C21 | Mean force of 4 single rings against field intensity peaks near 1.6 V/mm: 0.58, 1.91, 2.05, 1.95, 1.73, 1.50, 1.21, 0.91, 0.62, 0.47 mN at about 0.33 to 6.33 V/mm | see values | [D25] file 2N (forces); field levels read from [M25] Fig. 2N | yes | Claude 26 Nov: means recomputed from the four rings in file 2N (the seventh is 1.215); the file has no field levels, they are read from the plot, about 0.67 V/mm apart; Results: maximum at 1.6 V/mm, then a gradual decrease |
| C22 | Hand tissues (MuMuTAs): short-term force at 26-30 C was 1.01-1.13 of the value at 37 C, at 15 C 0.87-0.94, at 4 C 0.37-0.62 (n = 3) | see values | Ren, Morimoto & Takeuchi 2025, Dryad doi:10.5061/dryad.xd2547drh, file S5 | to confirm | Claude 25 Nov: from the CSV you attached |
| C23 | Hand simulation: the most exposed other actuator gets about 9-13 % of the target's field (volume-integrated), and a glass shield lowers that by about a quarter to 30 % | 9-13 %; 25-31 % | Ren et al. 2025 Dryad file S12B; README | yes | Claude 26 Nov: computed from file S12B (8.8 to 12.6 %; glass cuts 25.0 to 30.8 %). Corrected from 8-13 % and 25-33 % |
| C15 | A "neutral" half-normal prior with equal scales gives Pr(omega > 0.5) of about 70 % with no data | 0.705 | derivation 1 - (2/pi) arctan(1/2) = 0.7048; Monte Carlo 0.7049 | yes | Claude 25 Nov: rerun |
| C16 | A 6-of-9 pass rule passes with probability 0.73 when bounds hold 70 % of the time (independent cases); 0.99 at 90 %, 0.25 at 50 % | 0.73; 0.99; 0.25 | derivation, binomial: 0.7297; 0.9917; 0.2539 | yes | Claude 25 Nov: rerun |
| C17 | Four independent parts each at 90 % give 66 % | 0.656 | derivation 0.9^4 = 0.6561 | yes | Claude 25 Nov: rerun |
| C13 | Zhang et al. 2019 drive their biohybrid robots with one contractile stress from benchmark experiments, the same for every muscle (walker: absolute value of a sinusoid with that amplitude; swimmer: a fixed 12 uN cell force). Their elbow model instead uses fitted force-length curves | 12 uN | [Z19] Results, Eq. 1, Fig. 2 legend | yes | Claude 25 Nov, against the full article attached. Narrowed to Z19; the other two tools are C24 |
| C24 | Balciunaite 2026 and Castro 2026 also drive the muscle with a fixed force | - | Balciunaite 2026; Castro 2026 | to confirm | From the 23 Nov check; not attached on 25 Nov |
| L1 | Licence of [M25] | CC BY-NC 4.0 | [M25] front matter and last page | yes | Claude 26 Nov, full PDF: "Distributed under a Creative Commons Attribution NonCommercial License 4.0 (CC BY-NC)". The supplement (movies) was not attached: the clip credit assumes the movies carry the article's licence |
| L2 | Licence of [D25] | CC0 | [D25] Dryad page (the README states none) | to confirm | Not confirmed: check the licence field on the Dryad page |

## Incidents (shown on the laptop, no numbers)
- I1: During literature research, a summarising web-fetch tool returned claims about prior papers
  that no source supported. Fix: this ledger; every row needs a source read in full.
- I2: An early talk draft said "four rings give 0.84 of four times one ring". The paper reports
  proportional growth with n = 3 per count (C6), so the claim was dropped.
