import { useState, useMemo, useRef, useEffect } from 'react'

// ── Chassis Database (87 AL Bus Cowl Chassis — Sep 2025) ──────────────────────
const DB = [
  {cbn:"CCC20084D00011",fam:"CCC",model:"Cheetah",desc:"ASHOK LEYLAND CH2008.4T6R — 4200mm WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox · Shackle suspension · Tilt & Telescopic steering · EB, ESC · 7 × 10R20-16PR Radial",oll:8.4,fuel:"D",ac:"NAC",mrp:3103032},
  {cbn:"CCC20102D00015",fam:"CCC",model:"Cheetah",desc:"ASHOK LEYLAND CH2010.2T6R — 5334mm WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox · Shackle suspension · Tilt & Telescopic steering · EB, ESC · 7 × 10R20-16PR Radial",oll:10.2,fuel:"D",ac:"NAC",mrp:3139907},
  {cbn:"CCC20102D00014",fam:"CCC",model:"Cheetah",desc:"ASHOK LEYLAND CH2010.2T6R — 5334mm WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox · Shackle suspension · Tilt & Telescopic steering · EB, ESC · 7 × 295/80 R22.5 TL",oll:10.2,fuel:"D",ac:"NAC",mrp:3190609},
  {cbn:"CCV20109D00029",fam:"CCV",model:"Viking",desc:"ASHOK LEYLAND VK2010.9T6R — 5334mm WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox · Shackle suspension · Tilt & Telescopic steering · EB, ESC · 7 × 295/80 R22.5 TL",oll:10.9,fuel:"D",ac:"NAC",mrp:3172172},
  {cbn:"CCV20109D00030",fam:"CCV",model:"Viking",desc:"ASHOK LEYLAND VK2010.9T6R — 5334mm WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox · Shackle suspension with Retarder · Tilt & Telescopic steering · EB, ESC · 7 × 295/80 R22.5 TL (M)",oll:10.9,fuel:"D",ac:"NAC",mrp:3487453},
  {cbn:"CCV20114D00105",fam:"CCV",model:"Viking",desc:"ASHOK LEYLAND VK2011.4T6R — 5639mm WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox · Shackle suspension · Tilt & Telescopic steering · EB, ESC · 7 × 10R20-16PR Radial",oll:11.4,fuel:"D",ac:"NAC",mrp:3158344},
  {cbn:"CCV20114D00109",fam:"CCV",model:"Viking",desc:"ASHOK LEYLAND VK2011.4T6R — 5639mm WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox · Shackle suspension · Tilt & Telescopic steering · EB, ESC · 7 × 295/80 R22.5 TL",oll:11.4,fuel:"D",ac:"NAC",mrp:3190609},
  {cbn:"CCV20114D00107",fam:"CCV",model:"Viking",desc:"ASHOK LEYLAND VK2011.4T6R — 5639mm WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox · Rubber-ended suspension · Tilt & Telescopic steering · EB, ESC · 7 × 10R20-16PR Radial",oll:11.4,fuel:"D",ac:"NAC",mrp:3186000},
  {cbn:"CCV20114D00111",fam:"CCV",model:"Viking",desc:"ASHOK LEYLAND VK2011.4T6R — 5.57m WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox · Rubber-ended suspension · Tilt & Telescopic steering · EB, ESC · 7 × 295/80 R22.5 TL",oll:11.4,fuel:"D",ac:"NAC",mrp:3218266},
  {cbn:"CCV20114D00110",fam:"CCV",model:"Viking",desc:"ASHOK LEYLAND VK2011.4T6R — 5.57m WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox · Front rubber-ended & rear air suspension · Tilt & Telescopic steering · EB, ESC · 7 × 295/80 R22.5 TL",oll:11.4,fuel:"D",ac:"NAC",mrp:3458875},
  {cbn:"CCV20114D00115",fam:"CCV",model:"Viking",desc:"ASHOK LEYLAND VK2011.4T6R — 5639mm WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox · Rubber-ended suspension · Tilt & Telescopic steering · EB, ESC · 7 × 10R20-16PR Radial",oll:11.4,fuel:"D",ac:"NAC",mrp:3255141},
  {cbn:"CCV20114D00114",fam:"CCV",model:"Viking",desc:"ASHOK LEYLAND VK2011.4T6R — 5.29m WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox · Rubber-ended suspension · Tilt & Telescopic steering · EB, ESC · 7 × 295/80 R22.5 TL",oll:11.4,fuel:"D",ac:"NAC",mrp:3287407},
  {cbn:"CCV20114D00113",fam:"CCV",model:"Viking",desc:"ASHOK LEYLAND VK2011.4T6R — 5.29m WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox · Front rubber-ended & rear air suspension · Tilt & Telescopic steering · EB, ESC · 7 × 295/80 R22.5 TL",oll:11.4,fuel:"D",ac:"NAC",mrp:3528016},
  {cbn:"CCV20109D00028",fam:"CCV",model:"Viking",desc:"ASHOK LEYLAND VK2010.9T6R — 5334mm WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox · Front rubber-ended & rear air suspension · DDAC bracket · Tilt & Telescopic steering · EB, ESC · 7 × 295/80 R22.5 TL (M)",oll:10.9,fuel:"D",ac:"DDAC",mrp:3544609},
  {cbn:"CCV20109D00031",fam:"CCV",model:"Viking",desc:"ASHOK LEYLAND VK2010.9T6R — 5334mm WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox · Front rubber-ended & rear air suspension · DDAC bracket with Retarder · Tilt & Telescopic steering · EB, ESC · 7 × 295/80 R22.5 TL (M)",oll:10.9,fuel:"D",ac:"DDAC",mrp:3824859},
  {cbn:"CCV20114D00112",fam:"CCV",model:"Viking",desc:"ASHOK LEYLAND VK2011.4T6R — 5639mm WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox · Rubber-ended suspension · DDAC bracket · Tilt & Telescopic steering · EB, ESC · 7 × 295/80 R22.5 TL",oll:11.4,fuel:"D",ac:"DDAC",mrp:3313219},
  {cbn:"CCV20114D00106",fam:"CCV",model:"Viking",desc:"ASHOK LEYLAND VK2011.4T6R — 5639mm WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox · Front rubber-ended & rear air suspension · DDAC bracket · Tilt & Telescopic steering · EB, ESC · 7 × 295/80 R22.5 TL",oll:11.4,fuel:"D",ac:"DDAC",mrp:3553828},
  {cbn:"CCV13114G00016",fam:"CCV",model:"Viking CNG",desc:"ASHOK LEYLAND VK1311.4C6R — 5639mm WB · 'H' Series NA 6-cyl BS VI (127 HP) CNG engine · 6-speed gearbox · Rubber-ended suspension · 720L CNG tank · Tilt & Telescopic steering · EB, ESC · 7 × 10R20-16PR Radial",oll:11.4,fuel:"G",ac:"NAC",mrp:3449657},
  {cbn:"CCV13114G00017",fam:"CCV",model:"Viking CNG",desc:"ASHOK LEYLAND VK1311.4C6R — 5639mm WB · 'H' Series NA 6-cyl BS VI (127 HP) CNG engine · 6-speed gearbox · Rubber-ended suspension · 840L CNG tank · Tilt & Telescopic steering · EB, ESC · 7 × 295/80 R22.5 TL",oll:11.4,fuel:"G",ac:"NAC",mrp:3595313},
  {cbn:"CCV22114G00010",fam:"CCV",model:"Viking CNG TC",desc:"ASHOK LEYLAND VK2211.4C6R — 5639mm WB · 'H' Series 6-cyl BS VI CNG TC engine (216 HP) · 6-speed gearbox · Rubber-ended suspension · 720L CNG tank (WB door provision) · DDAC bracket · Tilt & Telescopic steering · EB, ESC · 7 × 295/80 R22.5 TL",oll:11.4,fuel:"G",ac:"DDAC",mrp:3666297},
  {cbn:"CCT20120D00072",fam:"CCT",model:"12M",desc:"ASHOK LEYLAND TF2012.0T6R — 6000mm WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox (no retarder) · Rubber-ended suspension · DDAC bracket · Unitised bearing · Tilt & Telescopic steering · EB, ESC · 7 × 295/80 R22.5 TL (M)",oll:12.0,fuel:"D",ac:"DDAC",mrp:3458875},
  {cbn:"CCT20120D00069",fam:"CCT",model:"12M",desc:"ASHOK LEYLAND TF2012.0T6R — 6000mm WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox (no retarder) · Front rubber-ended & rear air suspension · DDAC bracket · Tilt & Telescopic steering · EB, ESC · 7 × 295/80 R22.5 TL",oll:12.0,fuel:"D",ac:"DDAC",mrp:3618359},
  {cbn:"CCT20120D00071",fam:"CCT",model:"12M",desc:"ASHOK LEYLAND TF2012.0T6R — 6000mm WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox (no retarder) · Front rubber-ended & rear air suspension · DDAC bracket · Front disc brake · Unitised bearing · 7 × 295/80 R22.5 TL (M)",oll:12.0,fuel:"D",ac:"DDAC",mrp:3689344},
  {cbn:"CCT20120D00073",fam:"CCT",model:"12M",desc:"ASHOK LEYLAND TF2012.0T6R — 6000mm WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox (no retarder) · Full air suspension · DDAC bracket · Tilt & Telescopic steering · EB, ESC · 7 × 295/80 R22.5 TL",oll:12.0,fuel:"D",ac:"DDAC",mrp:3759407},
  {cbn:"CCT20120D00078",fam:"CCT",model:"12M",desc:"ASHOK LEYLAND TF2012.0T6R — 6000mm WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox (no retarder) · Full air suspension · Non-AC · Tilt & Telescopic steering · EB, ESC · 7 × 295/80 R22.5 TL",oll:12.0,fuel:"D",ac:"NAC",mrp:3800891},
  {cbn:"CCT20120D00075",fam:"CCT",model:"12M",desc:"ASHOK LEYLAND TF2012.0T6R — 6000mm WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox (no retarder) · Full air suspension · DDAC bracket · Front disc brake · Unitised bearing · EB, ESC · 7 × 295/80 R22.5 TL (M)",oll:12.0,fuel:"D",ac:"DDAC",mrp:3830391},
  {cbn:"CCT20120D00074",fam:"CCT",model:"12M",desc:"ASHOK LEYLAND TF2012.0T6R — 6000mm WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox with Retarder · Front rubber-ended & rear air suspension · DDAC bracket · 375L Polymer tank · EB, ESC · 7 × 295/80 R22.5 TL",oll:12.0,fuel:"D",ac:"DDAC",mrp:3929032},
  {cbn:"CCT20120D00070",fam:"CCT",model:"12M",desc:"ASHOK LEYLAND TF2012.0T6R — 6000mm WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox with Retarder · Front rubber-ended & rear air suspension · DDAC bracket · Front disc brake · Unitised bearing · EB, ESC · 7 × 295/80 R22.5 TL (M)",oll:12.0,fuel:"D",ac:"DDAC",mrp:3981578},
  {cbn:"CCT20120D00076",fam:"CCT",model:"12M",desc:"ASHOK LEYLAND TF2012.0T6R — 6000mm WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox with Retarder · Full air suspension · DDAC bracket · Front disc brake · Unitised bearing · EB, ESC · 7 × 295/80 R22.5 TL (M)",oll:12.0,fuel:"D",ac:"DDAC",mrp:4104188},
  {cbn:"CCT20120D00077",fam:"CCT",model:"12M",desc:"ASHOK LEYLAND TF2012.0T6R — 6000mm WB · 'H' Series iGen6 6-cyl BS VI (197 HP) · 6-speed OD gearbox with Retarder · Front rubber-ended & rear air suspension · DDAC bracket · EB, ESC · 7 × 295/80 R22.5 TL",oll:12.0,fuel:"D",ac:"DDAC",mrp:4102344},
  {cbn:"CCT25120D00023",fam:"CCT",model:"12M 250HP",desc:"ASHOK LEYLAND TF2512.0F6R — 6000mm WB · 'A' Series iGen6 4-cyl BS VI (248 HP) · 6-speed OD gearbox with Retarder · Full air suspension · DDAC bracket · Front disc brake · Unitised bearing · EB, ESC · 7 × 295/80 R22.5 TL (M)",oll:12.0,fuel:"D",ac:"DDAC",mrp:4279344},
  {cbn:"CCN25135D00033",fam:"CCN",model:"Garud 13.5M",desc:"ASHOK LEYLAND TF2513.5F6R — 7000mm WB · 'A' Series iGen6 4-cyl BS VI (248 HP) · 6-speed OD gearbox (no retarder) · Front rubber-ended & rear air suspension · DDAC bracket · Front disc brake · Unitised bearing · ESC · 7 × 295/80 R22.5 TL (M)",oll:13.5,fuel:"D",ac:"DDAC",mrp:4175172},
  {cbn:"CCN25135D00032",fam:"CCN",model:"Garud 13.5M",desc:"ASHOK LEYLAND TF2513.5F6R — 7000mm WB · 'A' Series iGen6 4-cyl BS VI (248 HP) · 6-speed OD gearbox · Front rubber-ended & rear air suspension · DDAC bracket · Retarder · ESC · 7 × 295/80 R22.5 TL (M)",oll:13.5,fuel:"D",ac:"DDAC",mrp:4366000},
  {cbn:"CCN25135D00015",fam:"CCN",model:"Garud 13.5M",desc:"ASHOK LEYLAND TF2513.5F6R — 7000mm WB · 'A' Series iGen6 4-cyl BS VI (248 HP) · 6-speed OD gearbox with Retarder · Front rubber-ended & rear air suspension · DDAC bracket · Front disc brake · Unitised bearing · ESC · 7 × 295/80 R22.5 TL (M)",oll:13.5,fuel:"D",ac:"DDAC",mrp:4436984},
  {cbn:"CCN25135D00035",fam:"CCN",model:"Garud 13.5M",desc:"ASHOK LEYLAND TF2513.5F6R — 7000mm WB · 'A' Series iGen6 4-cyl BS VI (248 HP) · 6-speed OD gearbox (no retarder) · Full air suspension · DDAC bracket · Front disc brake · Unitised bearing · ESC · 7 × 295/80 R22.5 TL (M)",oll:13.5,fuel:"D",ac:"DDAC",mrp:4440672},
  {cbn:"CCN25135D00016",fam:"CCN",model:"Garud 13.5M",desc:"ASHOK LEYLAND TF2513.5F6R — 7000mm WB · 'A' Series iGen6 4-cyl BS VI (248 HP) · 6-speed OD gearbox with Retarder · Full air suspension · DDAC bracket · Front disc brake · Unitised bearing · ESC · 7 × 295/80 R22.5 TL (M)",oll:13.5,fuel:"D",ac:"DDAC",mrp:4702484},
  {cbn:"CCN25135D00023",fam:"CCN",model:"Garud 13.5M",desc:"ASHOK LEYLAND TF2513.5F6R — 7000mm WB · 'H64V' Series iGen6 6-cyl BS VI (247 HP) · 6MT86 gearbox (no retarder) · Front rubber-ended & rear air suspension · DDAC bracket · Front disc brake · Unitised bearing · ESC · 7 × 295/80 R22.5 TL (M)",oll:13.5,fuel:"D",ac:"DDAC",mrp:4175172},
  {cbn:"CCN25135D00027",fam:"CCN",model:"Garud 13.5M",desc:"ASHOK LEYLAND TF2513.5F6R — 7000mm WB · 'H64V' Series iGen6 6-cyl BS VI (247 HP) · 6MT86 gearbox · Full air suspension · DDAC bracket · Retarder · ESC · 7 × 295/80 R22.5 TL (M)",oll:13.5,fuel:"D",ac:"DDAC",mrp:4366000},
  {cbn:"CCN25135D00025",fam:"CCN",model:"Garud 13.5M",desc:"ASHOK LEYLAND TF2513.5F6R — 7000mm WB · 'H64V' Series iGen6 6-cyl BS VI (247 HP) · 6MT86 gearbox with Retarder · Front rubber-ended & rear air suspension · DDAC bracket · Front disc brake · Unitised bearing · ESC · 7 × 295/80 R22.5 TL (M)",oll:13.5,fuel:"D",ac:"DDAC",mrp:4436984},
  {cbn:"CCN25135D00037",fam:"CCN",model:"Garud 13.5M",desc:"ASHOK LEYLAND TF2513.5F6R — 7000mm WB · 'H64V' Series iGen6 6-cyl BS VI (247 HP) · 6MT86 gearbox (no retarder) · Full air suspension · DDAC bracket · Front disc brake · Unitised bearing · ESC · 7 × 295/80 R22.5 TL (M)",oll:13.5,fuel:"D",ac:"DDAC",mrp:4440672},
  {cbn:"CCN25135D00026",fam:"CCN",model:"Garud 13.5M",desc:"ASHOK LEYLAND TF2513.5F6R — 7000mm WB · 'H64V' Series iGen6 6-cyl BS VI (247 HP) · 6MT86 gearbox with Retarder · Full air suspension · DDAC bracket · Front disc brake · Unitised bearing · ESC · 7 × 295/80 R22.5 TL (M)",oll:13.5,fuel:"D",ac:"DDAC",mrp:4702484},
  {cbn:"CCS15081D00005",fam:"CCS",model:"Sunshine",desc:"ASHOK LEYLAND SS1508.1T6R — 4560mm WB · 150HP BS VI engine · ESC · 7 × 7.50×16",oll:8.1,fuel:"D",ac:"NAC",mrp:2036496},
  {cbn:"CCS15094D00005",fam:"CCS",model:"Sunshine",desc:"ASHOK LEYLAND SS1509.4T6R — 5200mm WB · 150HP BS VI engine · ESC · 7 × 7.50×16",oll:9.4,fuel:"D",ac:"NAC",mrp:2106484},
  {cbn:"CCL15087D00029",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1508.7T6RL — 4200mm WB Chassis · ESC · 7 × 7.50×16",oll:8.7,fuel:"D",ac:"NAC",mrp:2096897},
  {cbn:"CCL15099D00016",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1509.9T6RL — 4900mm WB Chassis · ESC · 7 × 7.50×16",oll:9.9,fuel:"D",ac:"NAC",mrp:2190854},
  {cbn:"CCL15103D00028",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1510.3T6RL — 5200mm WB Chassis · ESC · 7 × 8.25×16",oll:10.3,fuel:"D",ac:"NAC",mrp:2224411},
  {cbn:"CCL15103D00031",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1510.3T6RL — 5200mm WB · LYNX MAX NAC Chassis · ESC · 7 × 235/75 R17.5",oll:10.3,fuel:"D",ac:"NAC",mrp:2286619},
  {cbn:"CCL15103D00020",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1510.3T6R — 5200mm WB Chassis · ESC · 7 × 235/75 R17.5",oll:10.3,fuel:"D",ac:"NAC",mrp:2283853},
  {cbn:"CCL15103D00047",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1510.3T6R — 5200mm WB Chassis (Mofussil) · ESC · 7 × 235/75 R17.5",oll:10.3,fuel:"D",ac:"NAC",mrp:2312616},
  {cbn:"CCL15103D00046",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1510.3T6R — 5200mm WB Chassis (Mofussil) · ESC · 7 × 8.25×16",oll:10.3,fuel:"D",ac:"NAC",mrp:2274634},
  {cbn:"CCL15099D00028",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1509.9T6R — 4900mm WB Chassis · ESC · 7 × 235/75 R17.5",oll:9.9,fuel:"D",ac:"NAC",mrp:2264678},
  {cbn:"CCL15099D00017",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1509.9T6RL — 4900mm WB Chassis · ESC · 7 × 235/75 R17.5",oll:9.9,fuel:"D",ac:"NAC",mrp:2235916},
  {cbn:"CCL15099D00035",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1509.9T6RL — 4900mm WB Chassis · ESC · 7 × 8.25×16",oll:9.9,fuel:"D",ac:"NAC",mrp:2255459},
  {cbn:"CCL15087D00018",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1508.7T6R — 4200mm WB Chassis · ESC · 7 × 235/75 R17.5",oll:8.7,fuel:"D",ac:"NAC",mrp:2178391},
  {cbn:"CCL15087D00038",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1508.7T6R — 4200mm WB Chassis · ESC · 7 × 7.50×16",oll:8.7,fuel:"D",ac:"NAC",mrp:2169172},
  {cbn:"CCL15079D00016",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1507.9T6R — 3900mm WB · LYNX MAX NAC Chassis · ESC · 7 × 235/75 R17.5",oll:7.9,fuel:"D",ac:"NAC",mrp:2159216},
  {cbn:"CCL15079D00009",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1507.9T6R — 3900mm WB Chassis · ESC · 7 × 235/75 R17.5",oll:7.9,fuel:"D",ac:"NAC",mrp:2149628},
  {cbn:"CCL15079D00017",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1507.9T6R — 3900mm WB Chassis · ESC · 7 × 7.50×16",oll:7.9,fuel:"D",ac:"NAC",mrp:2140409},
  {cbn:"CCL15103D00036",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1510.3T6RL — 5200mm WB · LYNX MAX AC Chassis · TM-43 A/C Compressor (engine-mounted) · ESC · 7 × 235/75 R17.5",oll:10.3,fuel:"D",ac:"TM43",mrp:2569204},
  {cbn:"CCL15103D00024",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1510.3T6R — 5200mm WB Chassis · TM-43 A/C Compressor (engine-mounted) · ESC · 7 × 235/75 R17.5",oll:10.3,fuel:"D",ac:"TM43",mrp:2537922},
  {cbn:"CCL15099D00026",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1509.9T6R — 4900mm WB Chassis · TM-43 A/C Compressor (engine-mounted) · ESC · 7 × 235/75 R17.5",oll:9.9,fuel:"D",ac:"TM43",mrp:2513953},
  {cbn:"CCL15087D00017",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1508.7T6R — 4200mm WB Chassis · TM-43 A/C Compressor (engine-mounted) · ESC · 7 × 235/75 R17.5",oll:8.7,fuel:"D",ac:"TM43",mrp:2489984},
  {cbn:"CCL15079D00015",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1507.9T6R — 3900mm WB Chassis · TM-43 A/C Compressor (engine-mounted) · ESC · 7 × 235/75 R17.5",oll:7.9,fuel:"D",ac:"TM43",mrp:2466016},
  {cbn:"CCL15103D00025",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1510.3T6R — 5200mm WB Chassis · TM-43 A/C Compressor (engine-mounted) · AMT · Air suspension · ESC · 7 × 235/75 R17.5",oll:10.3,fuel:"D",ac:"TM43",mrp:2939638},
  {cbn:"CCL15103D00048",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1510.3T6R — 5200mm WB Chassis · TM-43 A/C Compressor (engine-mounted) · Rear air suspension · ESC · 7 × 235/75 R17.5",oll:10.3,fuel:"D",ac:"TM43",mrp:2747888},
  {cbn:"CCL15099D00034",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1509.9T6R — 4900mm WB Chassis · TM-43 A/C Compressor (engine-mounted) · Rear air suspension · ESC · 7 × 235/75 R17.5",oll:9.9,fuel:"D",ac:"TM43",mrp:2714332},
  {cbn:"CCL15087D00037",fam:"CCL",model:"Lynx Smart",desc:"ASHOK LEYLAND LS1508.7T6R — 4200mm WB Chassis · TM-43 A/C Compressor (engine-mounted) · Rear air suspension · ESC · 7 × 235/75 R17.5",oll:8.7,fuel:"D",ac:"TM43",mrp:2645302},
  {cbn:"CCL10099G00004",fam:"CCL",model:"Lynx Smart CNG",desc:"ASHOK LEYLAND LS1009.9C6RV — 4900mm WB Chassis · 480WLC CNG tank · School · ESC · 7 × 8.25×16",oll:9.9,fuel:"G",ac:"NAC",mrp:2331791},
  {cbn:"CCL10099G00003",fam:"CCL",model:"Lynx Smart CNG",desc:"ASHOK LEYLAND LS1009.9C6RV — 4900mm WB Chassis · 480WLC CNG tank · Staff · ESC · 7 × 235/75 R17.5",oll:9.9,fuel:"G",ac:"NAC",mrp:2360553},
  {cbn:"CCL15099G00031",fam:"CCL",model:"Lynx Smart CNG",desc:"ASHOK LEYLAND LS1509.9C6RV — 4900mm WB Chassis · 480WLC CNG tank · ESC · 7 × 8.25×16",oll:9.9,fuel:"G",ac:"NAC",mrp:2489984},
  {cbn:"CCL15103G00027",fam:"CCL",model:"Lynx Smart CNG",desc:"ASHOK LEYLAND LS1510.3C6RVL — 5200mm WB Chassis · 480WLC CNG tank · ESC · 7 × 235/75 R17.5",oll:10.3,fuel:"G",ac:"NAC",mrp:2561891},
  {cbn:"CCL15103G00033",fam:"CCL",model:"Lynx Smart CNG",desc:"ASHOK LEYLAND LS1510.3C6RVL — 5200mm WB · LYNXMAX Chassis · 480WLC CNG tank · ESC · 7 × 235/75 R17.5",oll:10.3,fuel:"G",ac:"NAC",mrp:2540688},
  {cbn:"CCL15099G00032",fam:"CCL",model:"Lynx Smart CNG",desc:"ASHOK LEYLAND LS1509.9C6RVL — 4900mm WB Chassis · 480WLC CNG tank · TM-43 A/C Compressor (engine-mounted) · ESC · 7 × 235/75 R17.5",oll:9.9,fuel:"G",ac:"TM43",mrp:2825547},
  {cbn:"CCL15103G00028",fam:"CCL",model:"Lynx Smart CNG",desc:"ASHOK LEYLAND LS1510.3C6RVL — 5200mm WB Chassis · 480WLC CNG tank · TM-43 A/C Compressor (engine-mounted) · 6-speed · ESC · 7 × 235/75 R17.5",oll:10.3,fuel:"G",ac:"TM43",mrp:2873484},
  {cbn:"CCL15103G00036",fam:"CCL",model:"Lynx Smart CNG",desc:"ASHOK LEYLAND LS1510.3C6RVL — 5200mm WB · LYNXMAX Chassis · 480WLC CNG tank · TM-43 A/C Compressor (engine-mounted) · ESC · 7 × 235/75 R17.5",oll:10.3,fuel:"G",ac:"TM43",mrp:2940597},
  {cbn:"CCG15099D00011",fam:"CCG",model:"Lynx Strong",desc:"ASHOK LEYLAND LT1509.9T6R — 4900mm WB Chassis · ESC · 7 × 9R20",oll:9.9,fuel:"D",ac:"NAC",mrp:2536004},
  {cbn:"CCG15106D00011",fam:"CCG",model:"Lynx Strong",desc:"ASHOK LEYLAND LT1510.6T6R — 5334mm WB Chassis · 12V · ESC · 7 × 10R20",oll:10.6,fuel:"D",ac:"NAC",mrp:2619416},
  {cbn:"CCG15106D00012",fam:"CCG",model:"Lynx Strong",desc:"ASHOK LEYLAND LT1510.6T6R — 5334mm WB Chassis · 24V · ESC · 7 × 10R20",oll:10.6,fuel:"D",ac:"NAC",mrp:2643384},
  {cbn:"CCG15106D00013",fam:"CCG",model:"Lynx Strong",desc:"ASHOK LEYLAND LT1510.6T6R — 5334mm WB Chassis · 24V · Air suspension · ESC · 7 × 10R20",oll:10.6,fuel:"D",ac:"NAC",mrp:2883072},
  {cbn:"CCG15111D00013",fam:"CCG",model:"Lynx Strong",desc:"ASHOK LEYLAND LT1511.1T6R — 5639mm WB Chassis · 12V · ESC · 7 × 10R20",oll:11.1,fuel:"D",ac:"NAC",mrp:2678858},
  {cbn:"CCG15111D00014",fam:"CCG",model:"Lynx Strong",desc:"ASHOK LEYLAND LT1511.1T6R — 5639mm WB Chassis · 24V · ESC · 7 × 10R20",oll:11.1,fuel:"D",ac:"NAC",mrp:2737342},
  {cbn:"CCG15111D00015",fam:"CCG",model:"Lynx Strong",desc:"ASHOK LEYLAND LT1511.1T6R — 5639mm WB Chassis · 24V · Air suspension · ESC · 7 × 10R20",oll:11.1,fuel:"D",ac:"NAC",mrp:2977029},
  {cbn:"CCG15099D00009",fam:"CCG",model:"Lynx Strong",desc:"ASHOK LEYLAND LT1509.9T6R — 4900mm WB Chassis · TM-43 A/C Compressor (engine-mounted) · ESC · 7 × 9R20",oll:9.9,fuel:"D",ac:"TM43",mrp:2815959},
  {cbn:"CCG15106G00004",fam:"CCG",model:"Lynx Strong CNG",desc:"ASHOK LEYLAND LT1510.6C6R — 5334mm WB Chassis · 600WLC CNG tank · ESC · 7 × 9.00R20",oll:10.6,fuel:"G",ac:"NAC",mrp:3252191},
  {cbn:"CCG15111G00005",fam:"CCG",model:"Lynx Strong CNG",desc:"ASHOK LEYLAND LT1511.6C6R — 5639mm WB Chassis · 660WLC CNG tank · ESC · 7 × 10.00R20",oll:11.1,fuel:"G",ac:"NAC",mrp:3345189},
  {cbn:"CCG15106G00008",fam:"CCG",model:"Lynx Strong CNG",desc:"ASHOK LEYLAND LT1510.6C6R — 5334mm WB Chassis · 600WLC CNG tank · Air suspension · ESC · 7 × 9.00R20",oll:10.6,fuel:"G",ac:"NAC",mrp:3491878},
  {cbn:"CCG15111G00006",fam:"CCG",model:"Lynx Strong CNG",desc:"ASHOK LEYLAND LT1511.6C6R — 5639mm WB Chassis · 660WLC CNG tank · Air suspension · ESC · 7 × 10.00R20",oll:11.1,fuel:"G",ac:"NAC",mrp:3584877},
]

// ── Constants ──────────────────────────────────────────────────────────────────
const BODY_BASE = {
  school: { CCS:650000, CCL:650000, CCG:810000, CCC:800000, CCV:925000, CCT:950000, CCN:1000000 },
  staff:  { CCS:830000, CCL:830000, CCG:910000, CCC:885000, CCV:925000, CCT:1050000, CCN:1100000 },
}
const BODY_RATE = { CCS:25000, CCL:35000, CCG:45000, CCC:45000, CCV:45000, CCT:45000, CCN:45000 }
const MIN_OLL   = { CCS:8, CCL:7, CCG:9, CCC:8, CCV:10, CCT:12, CCN:13 }
const AC_REF    = { TM43:{ref:8,cost:275000}, NAC:{ref:7,cost:400000}, DDAC:{ref:8,cost:275000} }
const AC_PM     = 25000
const WIDTH     = { CCS:'88', CCL:'88', CCG:'96', CCC:'96', CCV:'96', CCT:'96', CCN:'96' }
const CFG_SPR   = { '3x3':6, '3x2':5, '2x2':4, '2x1':3 }
const SEAT_P    = { bench:1200, highback:2800, pushback:4300 }
const SB_P      = 1000
const ADDONS = [
  { id:'gallery',    name:'Sunken Gallery',   price:25000 },
  { id:'curtains',   name:'Curtains',         price:15000 },
  { id:'partition',  name:'Driver Partition', price:15000 },
  { id:'routeboard', name:'LED Route Board',  price:15000 },
  { id:'sdickey',    name:'Side Dickey',      price:10000 },
  { id:'bdickey',    name:'Back Dickey',      price:20000 },
  { id:'cctv_s',     name:'Simple CCTV',      price:15000 },
  { id:'cctv_l',     name:'Live CCTV',        price:30000 },
  { id:'tv',         name:'TV',               price:15000 },
]
const AO_INIT = Object.fromEntries(ADDONS.map(a => [a.id, false]))

// ── Helpers ────────────────────────────────────────────────────────────────────
const fmtL     = v => { const l = v / 100000; return '₹' + (l % 1 === 0 ? l.toFixed(0) : l.toFixed(2)) + 'L' }
const fmtINR   = v => '₹' + Math.round(v).toLocaleString('en-IN')
const parseInr = s => parseInt(String(s ?? '').replace(/[₹,\s]/g, ''), 10) || 0

function scoreItem(d, q) {
  const toks = q.toLowerCase().split(/\s+/).filter(Boolean)
  let s = 0
  for (const t of toks) {
    if (d.cbn.toLowerCase().startsWith(t)) s += 12
    else if (d.cbn.toLowerCase().includes(t)) s += 8
    if (d.model.toLowerCase().includes(t)) s += 7
    if (String(d.oll).includes(t)) s += 6
    if (d.fam.toLowerCase() === t) s += 5
    if (d.desc.toLowerCase().includes(t)) s += 2
    if (d.fuel === 'G' && (t === 'cng' || t === 'gas')) s += 6
  }
  return s
}

function calcBodyDefault(d, bodyT) {
  return BODY_BASE[bodyT][d.fam] + Math.round(Math.max(0, Math.floor(d.oll) - MIN_OLL[d.fam]) * BODY_RATE[d.fam])
}
function calcACDefault(d) {
  const r = AC_REF[d.ac]
  return r.cost + Math.round(Math.max(0, Math.floor(d.oll) - r.ref) * AC_PM)
}
function seatsForRows(rows, cfg) { return rows * CFG_SPR[cfg] + 1 }
function getAvailCfgs(d) {
  const cs = []
  if (WIDTH[d.fam] === '96') {
    cs.push({ id:'3x3', label:'3×3', note:'Bench only' })
    cs.push({ id:'3x2', label:'3×2', note:'All types' })
  } else {
    cs.push({ id:'3x2', label:'3×2', note:'Bench only' })
  }
  cs.push({ id:'2x2', label:'2×2', note:'All types' })
  cs.push({ id:'2x1', label:'2×1', note:'All types' })
  return cs
}
function getAvailSTs(cfg, fam) {
  if (cfg === '3x3') return [{ id:'bench', label:'Bench' }]
  if (cfg === '3x2' && WIDTH[fam] === '88') return [{ id:'bench', label:'Bench' }]
  return [
    { id:'bench',    label:'Bench' },
    { id:'highback', label:'Highback (HHR)' },
    { id:'pushback', label:'Pushback (SR)' },
  ]
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function BusCalculator() {
  const [searchQ, setSearchQ]   = useState('')
  const [searchOpen, setOpen]   = useState(false)
  const [filtered, setFiltered] = useState([])
  const [hiIdx, setHiIdx]       = useState(-1)
  const searchRef = useRef(null)

  const [sel, setSel]     = useState(null)
  const [dealP, setDealP] = useState(0)

  const [bodyT, setBodyT] = useState('school')
  const [bodyP, setBodyP] = useState(0)

  const [wantAC, setWantAC] = useState(false)
  const [acP, setAcP]       = useState(0)

  const [cfg, setCfg]       = useState('3x2')
  const [stType, setStType] = useState('bench')
  const [rows, setRows]     = useState(1)
  const [sbOn, setSbOn]     = useState(false)

  const [aoState, setAoState] = useState(AO_INIT)

  function onSearch(q) {
    setSearchQ(q)
    setHiIdx(-1)
    if (q.length < 1) { setOpen(false); return }
    const results = DB
      .map(d => ({ ...d, _s: scoreItem(d, q) }))
      .filter(d => d._s > 0)
      .sort((a, b) => b._s - a._s)
      .slice(0, 12)
    setFiltered(results)
    setOpen(true)
  }

  function onKeyDown(e) {
    if (!searchOpen) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHiIdx(i => Math.min(i + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHiIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && hiIdx >= 0) selectChassis(filtered[hiIdx])
    else if (e.key === 'Escape') setOpen(false)
  }

  function selectChassis(d) {
    const avCfgs = getAvailCfgs(d)
    const newCfg = avCfgs[0].id
    const newST  = getAvailSTs(newCfg, d.fam)[0].id
    setSel(d)
    setSearchQ(`${d.cbn} — ${d.model}`)
    setOpen(false)
    setDealP(d.mrp)
    setBodyP(calcBodyDefault(d, bodyT))
    setWantAC(false)
    setAcP(0)
    setCfg(newCfg)
    setStType(newST)
    setRows(Math.floor(d.oll))
    setSbOn(false)
    setAoState(AO_INIT)
  }

  function handleSetBodyT(t) {
    setBodyT(t)
    if (sel) setBodyP(calcBodyDefault(sel, t))
  }

  function handleSetCfg(c) {
    setCfg(c)
    if (sel) {
      const avSTs = getAvailSTs(c, sel.fam)
      if (!avSTs.find(t => t.id === stType)) {
        setStType(avSTs[0].id)
        setSbOn(false)
      }
    }
  }

  function handleSetST(t) {
    setStType(t)
    if (t !== 'highback' && t !== 'pushback') setSbOn(false)
  }

  function handleSetAC(v) {
    setWantAC(v)
    if (v && sel) setAcP(calcACDefault(sel))
    else setAcP(0)
  }

  const summary = useMemo(() => {
    if (!sel) return null
    const chassis  = dealP
    const body     = bodyP
    const ac       = wantAC ? acP : 0
    const seats    = seatsForRows(rows, cfg)
    const seatCost = seats * SEAT_P[stType]
    const sbCost   = sbOn ? seats * SB_P : 0
    const aoTotal  = ADDONS.reduce((s, a) => s + (aoState[a.id] ? a.price : 0), 0)
    return { chassis, body, ac, seats, seatCost, sbCost, aoTotal, total: chassis + body + ac + seatCost + sbCost + aoTotal }
  }, [sel, dealP, bodyP, wantAC, acP, rows, cfg, stType, sbOn, aoState])

  useEffect(() => {
    const handler = e => { if (searchRef.current && !searchRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const maxRows    = sel ? Math.floor(sel.oll) : 1
  const availCfgs  = sel ? getAvailCfgs(sel) : []
  const availSTs   = sel ? getAvailSTs(cfg, sel.fam) : []
  const dpDiff     = sel ? sel.mrp - dealP : 0
  const sbAllowed  = stType === 'highback' || stType === 'pushback'

  const bodyFormula = sel
    ? `${fmtINR(BODY_BASE[bodyT][sel.fam])}  base (${sel.fam} ${bodyT} @ ${MIN_OLL[sel.fam]}m)\n` +
      `+ ${Math.max(0, Math.floor(sel.oll) - MIN_OLL[sel.fam])}m extra × ${fmtINR(BODY_RATE[sel.fam])}/m\n` +
      `─────────────────────────\nBody = ${fmtL(calcBodyDefault(sel, bodyT))}`
    : ''

  const acFormula = sel && wantAC
    ? (() => {
        const r = AC_REF[sel.ac]
        const extra = Math.max(0, Math.floor(sel.oll) - r.ref)
        return `${fmtINR(r.cost)}  base (${sel.ac === 'TM43' ? 'TM-43' : 'NAC'} @ ${r.ref}m)\n` +
          `+ ${extra.toFixed(1)}m extra × ₹25,000/m\n─────────────────────────\nAC = ${fmtL(r.cost + Math.round(extra * AC_PM))}`
      })()
    : ''

  const seatFormula = sel
    ? `${cfg} · ${CFG_SPR[cfg]} seats/row + 1 extra\n` +
      `${rows} rows × ${CFG_SPR[cfg]} + 1 = ${seatsForRows(rows, cfg)} seats\n─────────────────────────\n` +
      `${seatsForRows(rows, cfg)} × ${fmtINR(SEAT_P[stType])} = ${fmtL(seatsForRows(rows, cfg) * SEAT_P[stType])}` +
      (sbOn ? `\n+ seatbelts ${fmtL(seatsForRows(rows, cfg) * SB_P)}` : '')
    : ''

  const acNote = !sel ? null
    : sel.ac === 'TM43' ? { cls: 'bc-note grn', text: 'Factory TM-43 engine-mounted compressor fitted. Body builder adds ducting and rooftop evaporator — lower cost.' }
    : sel.ac === 'DDAC' ? { cls: 'bc-note blu', text: 'DDAC bracket pre-fitted. Body builder installs rooftop unit and compressor.' }
    :                     { cls: 'bc-note amb', text: 'Non-AC chassis. Full AC system required — compressor, ducting, and rooftop unit. Higher cost.' }

  return (
    <div>
      <div className="page-header">
        <h1>Bus Price Calculator</h1>
        <p>Build a chassis + body estimate step by step — all prices incl. GST</p>
      </div>

      <div className="bc-layout">

        {/* ── LEFT: INPUTS ── */}
        <div>

          {/* STEP 1 — CHASSIS */}
          <div className="q-section" style={{ marginBottom: 16 }}>
            <div className="q-section-title">
              <span className="bc-step-pill">STEP 1</span> Chassis Selection
            </div>

            <div className="bc-srch-wrap" ref={searchRef}>
              <span className="bc-srch-ico">⌕</span>
              <input
                type="text"
                className="bc-srch-in"
                value={searchQ}
                onChange={e => onSearch(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search CBN, model (Viking, Lynx), or length (11.4m, CNG)…"
                autoComplete="off"
                spellCheck="false"
              />
              {searchOpen && (
                <div className="bc-drop">
                  {filtered.length === 0
                    ? <div className="bc-drop-empty">No matching chassis found</div>
                    : filtered.map((d, i) => (
                        <div
                          key={d.cbn}
                          className={`bc-drop-item${i === hiIdx ? ' hi' : ''}`}
                          onMouseDown={() => selectChassis(d)}
                        >
                          <div className="bc-drop-cbn">{d.cbn}</div>
                          <div className="bc-drop-model">
                            {d.model} · {d.oll}m · {d.fuel === 'G' ? 'CNG' : 'Diesel'} ·{' '}
                            {d.ac === 'TM43' ? 'TM-43 AC Compressor' : d.ac === 'DDAC' ? 'DDAC Bracket' : 'Non-AC Chassis'}
                          </div>
                          <div className="bc-drop-desc">{d.desc.slice(0, 130)}{d.desc.length > 130 ? '…' : ''}</div>
                          <div className="bc-drop-mrp">{fmtL(d.mrp)}&nbsp; MRP incl. GST</div>
                        </div>
                      ))
                  }
                </div>
              )}
            </div>

            {sel && (
              <div className="bc-chassis-card">
                <div className="bc-chassis-top">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="bc-cbn">{sel.cbn}</div>
                    <div className="bc-model-line">{sel.model} · {sel.oll}m · {sel.fuel === 'G' ? 'CNG' : 'Diesel'} · {sel.ac === 'TM43' ? 'TM-43 Compressor' : sel.ac === 'DDAC' ? 'DDAC Bracket' : 'Non-AC'}</div>
                    <div className="bc-desc-box">{sel.desc}</div>
                  </div>
                  <div className="bc-mrp-wrap">
                    <div className="bc-mrp-lbl">MRP incl. GST</div>
                    <div className="bc-mrp-val">{fmtL(sel.mrp)}</div>
                  </div>
                </div>
                <div className="bc-tags">
                  <span className="bc-tag bc-tag-oll">{sel.oll}m OLL</span>
                  <span className={`bc-tag ${sel.fuel === 'G' ? 'bc-tag-cng' : 'bc-tag-diesel'}`}>{sel.fuel === 'G' ? 'CNG' : 'Diesel'}</span>
                  <span className={`bc-tag ${sel.ac === 'TM43' ? 'bc-tag-tm43' : sel.ac === 'DDAC' ? 'bc-tag-ddac' : 'bc-tag-nac'}`}>
                    {sel.ac === 'TM43' ? 'TM-43' : sel.ac === 'DDAC' ? 'DDAC' : 'Non-AC'}
                  </span>
                  <span className="bc-tag bc-tag-width">{WIDTH[sel.fam]}" Width</span>
                </div>

                <div className="bc-dp-grp">
                  <div className="bc-dp-row">
                    <span className="bc-dp-lbl">Deal Price</span>
                    <div className="bc-dp-right">
                      <span className="bc-dp-pfx">₹</span>
                      <input
                        type="text"
                        className="bc-numinput"
                        value={dealP.toLocaleString('en-IN')}
                        onChange={e => { const v = parseInr(e.target.value); if (v >= 0) setDealP(v) }}
                      />
                    </div>
                  </div>
                  <input type="range" min={0} max={sel.mrp} step={10000} value={dealP}
                    onChange={e => setDealP(+e.target.value)}
                    style={{ width: '100%', marginTop: 8 }}
                  />
                  <div className="bc-sl-ends"><span>₹0</span><span>MRP</span></div>
                  {dpDiff > 0 && <div className="bc-dp-chip below">↓ {fmtL(dpDiff)} below MRP ({((dpDiff / sel.mrp) * 100).toFixed(1)}% discount)</div>}
                  {dpDiff < 0 && <div className="bc-dp-chip above">↑ {fmtL(Math.abs(dpDiff))} above MRP</div>}
                  {dpDiff === 0 && <div className="bc-dp-chip at">= At MRP</div>}
                </div>
              </div>
            )}
          </div>

          {sel && <>
            {/* STEP 2 — BODY */}
            <div className="q-section" style={{ marginBottom: 16 }}>
              <div className="q-section-title"><span className="bc-step-pill">STEP 2</span> Body Type</div>
              <div className="bc-rg">
                <div className={`bc-rb${bodyT === 'school' ? ' on' : ''}`} onClick={() => handleSetBodyT('school')}>🏫 School</div>
                <div className={`bc-rb${bodyT === 'staff' ? ' on' : ''}`} onClick={() => handleSetBodyT('staff')}>💼 Staff</div>
              </div>
              <div className="bc-dp-row" style={{ marginTop: 16 }}>
                <span className="bc-dp-lbl">Body Price</span>
                <div className="bc-dp-right">
                  <span className="bc-dp-pfx">₹</span>
                  <input type="text" className="bc-numinput"
                    value={bodyP.toLocaleString('en-IN')}
                    onChange={e => setBodyP(parseInr(e.target.value))}
                  />
                </div>
              </div>
              <div className="bc-formula">{bodyFormula}</div>
            </div>

            {/* STEP 3 — AC */}
            <div className="q-section" style={{ marginBottom: 16 }}>
              <div className="q-section-title"><span className="bc-step-pill">STEP 3</span> Air Conditioning</div>
              {acNote && <div className={acNote.cls}>{acNote.text}</div>}
              <div className="bc-rg" style={{ marginTop: 12 }}>
                <div className={`bc-rb${wantAC ? ' on' : ''}`} onClick={() => handleSetAC(true)}>❄ With AC</div>
                <div className={`bc-rb${!wantAC ? ' on' : ''}`} onClick={() => handleSetAC(false)}>— Non-AC</div>
              </div>
              {wantAC && (
                <div style={{ marginTop: 16 }}>
                  <div className="bc-dp-row">
                    <span className="bc-dp-lbl">AC Cost</span>
                    <div className="bc-dp-right">
                      <span className="bc-dp-pfx">₹</span>
                      <input type="text" className="bc-numinput"
                        value={acP.toLocaleString('en-IN')}
                        onChange={e => setAcP(parseInr(e.target.value))}
                      />
                    </div>
                  </div>
                  <div className="bc-formula">{acFormula}</div>
                </div>
              )}
            </div>

            {/* STEP 4 — SEATING */}
            <div className="q-section" style={{ marginBottom: 16 }}>
              <div className="q-section-title"><span className="bc-step-pill">STEP 4</span> Seating</div>

              <div className="form-label">Configuration</div>
              <div className="bc-rg">
                {availCfgs.map(c => (
                  <div key={c.id} className={`bc-rb${cfg === c.id ? ' on' : ''}`} onClick={() => handleSetCfg(c.id)}>
                    {c.label} <small style={{ fontWeight:400, opacity:0.65 }}>{c.note}</small>
                  </div>
                ))}
              </div>
              <div className={`bc-note${WIDTH[sel.fam] === '96' ? ' blu' : ''}`} style={{ marginTop: 8 }}>
                {WIDTH[sel.fam] === '96'
                  ? '96" width chassis — 3×3 and 3×2 available.'
                  : '88" width chassis — 3×3 not available. 3×2 bench-only.'}
              </div>

              <div className="form-label" style={{ marginTop: 16 }}>Seat Type</div>
              <div className="bc-rg">
                {availSTs.map(t => (
                  <div key={t.id} className={`bc-rb${stType === t.id ? ' on' : ''}`} onClick={() => handleSetST(t.id)}>
                    {t.label} <small style={{ fontWeight:400, opacity:0.65 }}>₹{SEAT_P[t.id].toLocaleString('en-IN')}/seat</small>
                  </div>
                ))}
              </div>

              <div className="form-label" style={{ marginTop: 16 }}>Rows & Seat Count</div>
              <div className={`bc-note${rows === maxRows ? ' grn' : ' blu'}`} style={{ marginBottom: 8 }}>
                {rows === maxRows
                  ? `Maximum config for ${sel.oll}m — ${maxRows} rows, ${seatsForRows(rows, cfg)}+D seats in ${cfg} layout.`
                  : `${maxRows - rows} row${maxRows - rows > 1 ? 's' : ''} removed vs maximum — extra legroom added.`}
              </div>
              <select className="form-select" value={rows} onChange={e => setRows(+e.target.value)}>
                {Array.from({ length: maxRows }, (_, i) => maxRows - i).map(r => (
                  <option key={r} value={r}>
                    {seatsForRows(r, cfg)}+D seats — {r} rows{r === maxRows ? ' (maximum)' : ''}
                  </option>
                ))}
              </select>
              <div className="bc-formula">{seatFormula}</div>

              <div
                className={`bc-tog-row${!sbAllowed ? ' disabled' : ''}`}
                onClick={() => sbAllowed && setSbOn(v => !v)}
              >
                <div className="bc-tog-l">
                  <span className="bc-tog-name">3-Point Seatbelt</span>
                  <span className="bc-tog-pr">+₹1,000 per seat · Highback &amp; Pushback only</span>
                </div>
                <div className={`bc-sw${sbOn ? ' on' : ''}`} />
              </div>
              {sbOn && (
                <div className="bc-note amb">
                  {seatsForRows(rows, cfg)} seats × ₹1,000 = {fmtL(seatsForRows(rows, cfg) * SB_P)} additional
                </div>
              )}
            </div>

            {/* STEP 5 — ADD-ONS */}
            <div className="q-section">
              <div className="q-section-title"><span className="bc-step-pill">STEP 5</span> Add-ons</div>
              {ADDONS.map(a => (
                <div key={a.id} className="bc-tog-row"
                  onClick={() => setAoState(prev => ({ ...prev, [a.id]: !prev[a.id] }))}
                >
                  <div className="bc-tog-l">
                    <span className="bc-tog-name">{a.name}</span>
                    <span className="bc-tog-pr">{fmtL(a.price)}</span>
                  </div>
                  <div className={`bc-sw${aoState[a.id] ? ' on' : ''}`} />
                </div>
              ))}
            </div>
          </>}
        </div>

        {/* ── RIGHT: SUMMARY ── */}
        <div>
          <div className="bc-sum-panel">
            <div className="bc-sum-hd">
              <div className="bc-sum-lbl">Total Estimated Price</div>
              <div className={`bc-sum-total${summary ? ' live' : ''}`}>
                {summary ? fmtL(summary.total) : 'Select a chassis'}
              </div>
            </div>

            {!summary ? (
              <div className="bc-sum-ph">
                <div className="bc-sum-ph-ico">🚌</div>
                <div className="bc-sum-ph-txt">Search a CBN or model in Step 1 to begin building the price estimate.</div>
              </div>
            ) : (
              <div className="bc-sum-body">
                <div className="bc-sum-row">
                  <span className="bc-sum-rl bold">Chassis</span>
                  <span className="bc-sum-rv">{fmtL(summary.chassis)}</span>
                </div>
                <div className="bc-sum-row">
                  <span className="bc-sum-rl bold">Body{wantAC ? ' + AC' : ''}</span>
                  <span className="bc-sum-rv">{fmtL(summary.body + summary.ac)}</span>
                </div>
                <div className="bc-sum-row">
                  <span className="bc-sum-rl bold">Seats{summary.aoTotal > 0 ? ' + Add-ons' : ''}</span>
                  <span className="bc-sum-rv">{fmtL(summary.seatCost + summary.sbCost + summary.aoTotal)}</span>
                </div>
                <div className="bc-sum-grand">
                  <div className="bc-sum-gl">Total Fully Built<br /><span style={{ fontSize:9, opacity:.7 }}>All prices incl. GST</span></div>
                  <div className="bc-sum-gv">{fmtL(summary.total)}</div>
                </div>
                <BreakdownPanel
                  sel={sel} summary={summary} dealP={dealP} bodyT={bodyT} bodyP={bodyP}
                  wantAC={wantAC} acP={acP} rows={rows} cfg={cfg} stType={stType}
                  sbOn={sbOn} aoState={aoState}
                />
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}

// ── Breakdown sub-component ────────────────────────────────────────────────────
function BreakdownPanel({ sel, summary, dealP, bodyT, bodyP, wantAC, acP, rows, cfg, stType, sbOn, aoState }) {
  const [open, setOpen] = useState(false)
  const activeAOs = ADDONS.filter(a => aoState[a.id])

  return (
    <>
      <div className="bc-breakdown-toggle" onClick={() => setOpen(v => !v)}>
        <span className="bc-breakdown-lbl">Detailed Breakdown</span>
        <span className={`bc-breakdown-arrow${open ? ' open' : ''}`}>▾</span>
      </div>
      {open && (
        <div className="bc-breakdown-body">
          <div className="bc-sum-sec">Chassis</div>
          <div className="bc-sum-row">
            <span className="bc-sum-rl">MRP (incl. GST)</span>
            <span className="bc-sum-rv dim">{fmtL(sel.mrp)}</span>
          </div>
          <div className="bc-sum-row">
            <span className="bc-sum-rl">Deal Price</span>
            <span className={`bc-sum-rv${dealP < sel.mrp ? ' grn' : dealP > sel.mrp ? ' amb' : ''}`}>{fmtL(dealP)}</span>
          </div>
          {dealP < sel.mrp && (
            <div className="bc-sum-row" style={{ fontSize: 12 }}>
              <span className="bc-sum-rl" style={{ color:'#16A34A' }}>Discount</span>
              <span className="bc-sum-rv grn">−{fmtL(sel.mrp - dealP)} ({((sel.mrp - dealP) / sel.mrp * 100).toFixed(1)}%)</span>
            </div>
          )}
          <div className="bc-sum-dv" />
          <div className="bc-sum-sec">Body</div>
          <div className="bc-sum-row">
            <span className="bc-sum-rl">{bodyT === 'school' ? 'School' : 'Staff'} Body — {sel.fam}</span>
            <span className="bc-sum-rv">{fmtL(bodyP)}</span>
          </div>
          {wantAC && (
            <div className="bc-sum-row">
              <span className="bc-sum-rl">AC System ({sel.ac})</span>
              <span className="bc-sum-rv">{fmtL(acP)}</span>
            </div>
          )}
          <div className="bc-sum-dv" />
          <div className="bc-sum-sec">Seating</div>
          <div className="bc-sum-row">
            <span className="bc-sum-rl">{seatsForRows(rows, cfg)} seats ({cfg} · {stType})</span>
            <span className="bc-sum-rv">{fmtL(summary.seatCost)}</span>
          </div>
          {sbOn && (
            <div className="bc-sum-row">
              <span className="bc-sum-rl">3-Point Seatbelts</span>
              <span className="bc-sum-rv">{fmtL(summary.sbCost)}</span>
            </div>
          )}
          {activeAOs.length > 0 && <>
            <div className="bc-sum-dv" />
            <div className="bc-sum-sec">Add-ons</div>
            {activeAOs.map(a => (
              <div key={a.id} className="bc-sum-row">
                <span className="bc-sum-rl">{a.name}</span>
                <span className="bc-sum-rv">{fmtL(a.price)}</span>
              </div>
            ))}
          </>}
          <div className="bc-sum-note">Estimate only. Final price subject to body builder quote, RTO, insurance, and dealer terms.</div>
        </div>
      )}
    </>
  )
}
