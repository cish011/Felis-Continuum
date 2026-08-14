# Real-cat reference ledger

This prototype uses published measurements, multi-animal datasets, anatomical atlases, and motion footage as observation sources. They inform newly constructed procedural geometry and behavior; no source image or video is copied into or redistributed with the game.

The baseline is a healthy adult mesocephalic domestic shorthair. Breed extremes, kittens, obesity, pregnancy, and longhair silhouettes are not averaged into its anatomy. Coat variants are original procedural patterns.

## Anatomy translated into the rig

- The axial plan follows the feline `C7 / T13 / L7 / S3` pattern and a long tapered caudal chain. Rendered geometry uses a reduced control chain while retaining distinct thoracic, lumbar, pelvis, and tail motion.
- Functional hindlimbs are longer than forelimbs. Muscle volume stays proximal at scapula/triceps and thigh/gluteal groups; radius, tibia, metapodials, and digitigrade paws taper sharply.
- Scapular masses translate and rotate against the rib cage. They are not fused shoulder hinges.
- The skull is mesocephalic with a short facial portion, zygomatic width, paired whisker pads, convex cornea, recessed iris, nonlinear vertical pupil, mobile eyelids, thin pinnae, and independent ear orientation.
- Forepaws and hindpaws differ: forepaws include raised pollex/carpal detail; hindpaws do not. Central pads are lobed rather than circular and receive matte compliant shading.
- Fur separates dense down volume, awn transition, and sparse guard/silhouette layers. Hair direction follows regional vector fields and tailward flow rather than uniform noise.
- Pattern generation layers pigment base, body-region tabby domains, agouti band suggestion, ventral white spotting, coherent tortoiseshell/calico regions, and cool-extremity point coloration.

## Motion translated into controllers

- A continuous phase oscillator schedules contact, but planted paws remain locked in world space and the body solves around them.
- Ordinary walking uses a lateral sequence biased `right hind → right fore → left hind → left fore`. Increased speed primarily reduces stance duration; it does not simply fast-forward a clip.
- Swing targets stabilize near lift and placement. Terrain and obstacle clearance override idealized repeated footprints.
- Gaze samples terrain roughly one to three steps ahead; eyes orient before head, ears, and torso.
- Narrow paths lower speed, narrow stance, raise swing clearance, lower/incline the head, and recruit tail counter-angular momentum based on balance error.
- Jumping separates variable anticipation, a short proximal-to-distal hind drive, physical airborne trajectory, front-paw preparation, compliant fore contact, hind contact, compression, and recovery.
- Grooming uses persistent body-region debt and can resume after interruption. Licks vary around observed travel, speed, and rate rather than looping on a fixed timer.

## Primary and authoritative sources

### Anatomy, paws, face, and coat

1. [UT Austin DigiMorph domestic-cat CT and skeleton rotations](https://www2.geo.utexas.edu/specimens/Felis_sylvestris_catus/)
2. [Universidad Nacional de Colombia feline myology atlas](https://animalbodiesun.wixsite.com/miologia-felina/informacion)
3. [CONICET domestic-cat skeletal atlas](https://incihusa.mendoza-conicet.gob.ar/zoo/?page_id=950)
4. [Multi-specimen feline skull views and measurements](https://dept.dokkyomed.ac.jp/dep-m/macro/mammal/en/species_all/felis_catus.html)
5. [CT skull morphometry across 37 cats](https://pmc.ncbi.nlm.nih.gov/articles/PMC8402625/)
6. [Large 3D domestic-cat skull morphology study](https://pmc.ncbi.nlm.nih.gov/articles/PMC12067280/)
7. [Cat forelimb musculoskeletal model and live kinematics](https://pmc.ncbi.nlm.nih.gov/articles/PMC11737544/)
8. [Associated multi-part forelimb anatomy/model data](https://github.com/BorisPrilutskyLab/CatForelimbNeuromechanics)
9. [Cat hindlimb 3D musculoskeletal model](https://pmc.ncbi.nlm.nih.gov/articles/PMC2043500/)
10. [Live-cat limb dimensions and narrow-path data](https://pmc.ncbi.nlm.nih.gov/articles/PMC4644224/)
11. [Scapular movement in walking, trotting, and galloping](https://pubmed.ncbi.nlm.nih.gov/642016/)
12. [Measured domestic-cat paw-pad anatomy](https://www.jstage.jst.go.jp/article/jmammsocjapan1952/2/2/2_2_35/_pdf)
13. [University of Minnesota feline paw anatomy](https://vanat.ahc.umn.edu/carnLabs/Lab04/Img4-2.html)
14. [Paw-pad microstructure and nonlinear mechanics](https://pmc.ncbi.nlm.nih.gov/articles/PMC6699342/)
15. [Claw morphology and retraction](https://pmc.ncbi.nlm.nih.gov/articles/PMC2736126/)
16. [CatFACS facial anatomy and action definitions](https://pure.port.ac.uk/ws/portalfiles/portal/5970434/Development_and_application_of_CatFACS.pdf)
17. [CatFLW multi-breed 48-landmark facial dataset](https://github.com/martvelge/CatFLW)
18. [Normal feline ocular biometry](https://pubmed.ncbi.nlm.nih.gov/22280390/)
19. [Comparative ocular geometry](https://pmc.ncbi.nlm.nih.gov/articles/PMC4742968/)
20. [Normal coat hair populations and KRT71](https://pmc.ncbi.nlm.nih.gov/articles/PMC2974189/)
21. [Compound follicle organization in feline skin](https://pmc.ncbi.nlm.nih.gov/articles/PMC7895312/)
22. [Developmental basis of tabby geometry](https://www.nature.com/articles/s41467-021-25348-2)
23. [Taqpep, Edn3, and feline pigment-pattern biology](https://pmc.ncbi.nlm.nih.gov/articles/PMC3709578/)
24. [Genetic mapping of tabby, spotted, and ticked patterns](https://pmc.ncbi.nlm.nih.gov/articles/PMC2815922/)
25. [KIT-associated white spotting](https://pmc.ncbi.nlm.nih.gov/articles/PMC4199695/)
26. [UC Davis colorpoint genetics](https://vgl.ucdavis.edu/test/colorpoint-restriction)
27. [Oxford-IIIT multi-breed cat image dataset](https://www.robots.ox.ac.uk/~vgg/data/pets/)

### Locomotion, jumping, balance, grooming, and behavior

28. [Multi-cat walk, trot, gallop, jump, and landing study](https://doi.org/10.1002/jmor.1051410102)
29. [Three-dimensional hindlimb joint kinematics](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0197837)
30. [Speed-dependent interlimb coordination](https://pmc.ncbi.nlm.nih.gov/articles/PMC4044364/)
31. [Speed-dependent locomotor adjustments](https://pmc.ncbi.nlm.nih.gov/articles/PMC8863752/)
32. [Swing-paw trajectory stabilization](https://pmc.ncbi.nlm.nih.gov/articles/PMC4137248/)
33. [Whole-body mechanics of stealth walking, with videos](https://pmc.ncbi.nlm.nih.gov/articles/PMC2583958/)
34. [Obstacle-avoidance experiment](https://pmc.ncbi.nlm.nih.gov/articles/PMC5539443/)
35. [Gaze behavior while stepping on complex terrain](https://pmc.ncbi.nlm.nih.gov/articles/PMC4169884/)
36. [Gaze/stride coordination](https://pubmed.ncbi.nlm.nih.gov/31460673/)
37. [Measured cat jumping mechanics](https://doi.org/10.1242/jeb.91.1.73)
38. [Morphology and maximum jump performance](https://doi.org/10.1242/jeb.205.24.3877)
39. [Landing joint work and force distribution](https://pmc.ncbi.nlm.nih.gov/articles/PMC6721424/)
40. [Domestic-cat vertical climbing dynamics](https://doi.org/10.1007/s42235-022-00248-3)
41. [Individual claw-direction control](https://doi.org/10.1016/S0168-0102(98)00056-X)
42. [Paw grasp preshaping and digit timing](https://doi.org/10.1046/j.1460-9568.1998.00399.x)
43. [Narrow-path balance and tail response](https://pmc.ncbi.nlm.nih.gov/articles/PMC4644224/)
44. [High-speed tongue and fur-grooming mechanics](https://pmc.ncbi.nlm.nih.gov/articles/PMC6298077/)
45. [Multi-region grooming sequence study](https://doi.org/10.1016/S0168-1591(00)00094-0)
46. [Large multi-cat visual ethogram and supplementary data](https://www.mdpi.com/2813-9372/1/3/21)
47. [CatFACS spontaneous-behavior development study](https://doi.org/10.1016/j.applanim.2017.01.005)
48. [Domestic-cat interaction signals](https://pmc.ncbi.nlm.nih.gov/articles/PMC8469685/)
49. [Human-cat slow-blink experiments](https://doi.org/10.1038/s41598-020-73426-0)
50. [Feline Grimace Scale validation](https://pmc.ncbi.nlm.nih.gov/articles/PMC6911058/)
51. [Holistic feline emotion assessment review](https://pmc.ncbi.nlm.nih.gov/articles/PMC7995744/)

Absolute angles and speeds vary across cats and study conditions. Phase relationships and contact logic are used as calibration anchors, then varied by morphology, terrain, personality, and current arousal.
