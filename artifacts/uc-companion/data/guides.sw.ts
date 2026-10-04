import type { Guide } from './guides';

type SwahiliGuide = Required<Pick<Guide, 'titleSw' | 'summarySw' | 'sectionsSw'>>;

/** Bundled Kiswahili translations. Keep quantities, warnings and product names
 * aligned with the corresponding English instructions. */
export const GUIDES_SW: Record<string, SwahiliGuide> = {
  'bottle-setup': {
    titleSw: 'Kuanza kutumia chupa yako yenye kichujio',
    summarySw: 'Fungua kifurushi, andaa kichujio, na uanze kunywa maji safi yaliyothibitishwa ndani ya dakika 5.',
    sectionsSw: [
      {
        heading: 'Vilivyomo kwenye kifurushi',
        body: 'Chupa yako ya Ultra Clear inakuja na mwili wa chupa, katriji moja ya kichujio cha Ahlstrom Disruptor® iliyowekwa tayari, kifuniko, na kadi ya dhamana. Survivor Straw pia inakuja na kifaa cha kusafisha.',
      },
      {
        heading: 'Kabla ya matumizi ya kwanza',
        tip: 'Daima pitisha maji kwenye kichujio ili kukiandaa kabla ya kunywa. Kichujio ambacho hakijaandaliwa kinaweza kufanya maji yawe na ladha kidogo ya karatasi.',
        steps: [
          'Ondoa chupa kwenye kifurushi na utoe vifaa vyote vya kuilinda vilivyowekwa ndani.',
          'Fungua kifuniko kwa kukizungusha na uhakikishe katriji imekaa vizuri — isukume chini kwa upole hadi uhisi imebofya au imekaa imara.',
          'Jaza chupa hadi juu kwa maji safi ya bomba.',
          'Funga kifuniko na ubonyeze chupa kwa upole juu ya sinki. Mibonyezo 2–3 ya kwanza itatoa hewa kwenye kichujio — maji yanayotoka yanaweza kuonekana na ukungu kidogo. Hii ni kawaida.',
          'Mwaga maji yaliyochujwa ya chupa mbili za kwanza zilizojaa (au pitisha mililita 150 kila mara kwa kubonyeza chupa).',
          'Jaza tena, kunywa, na ufurahie maji safi yaliyothibitishwa.',
        ],
      },
      {
        heading: 'Matumizi ya kila siku',
        steps: [
          'Jaza maji ya bomba, kisima kirefu, au maji ya juu ya ardhi kama ya mto.',
          'Kunywa moja kwa moja kupitia sehemu ya kunywea (Hydra Flux, Truva Go, Viva Drop, Timbo, Gym Buddy) au bonyeza maji yatoke kupitia mrija / nozeli (Flex, Breeze).',
          'Kichujio cha Ahlstrom Disruptor® huondoa >99.9% ya bakteria na protozoa maji yanapopita ndani yake. Hakuna kusubiri — uchujaji hufanyika papo hapo.',
          'Funga kifuniko cha sehemu ya kunywea wakati huitumii ili kuzuia uchafuzi.',
        ],
      },
      {
        heading: 'Kusafisha mwili wa chupa',
        steps: [
          'Ondoa katriji kabla ya kuosha. Katriji haipaswi kuwekwa kwenye mashine ya kuosha vyombo.',
          'Osha mwili wa chupa na kifuniko kwa maji ya uvuguvugu na sabuni laini ya vyombo.',
          'Suuza vizuri — hakuna mabaki ya sabuni yanayopaswa kubaki.',
          'Iache ikauke kwa hewa ikiwa imegeuzwa juu chini kabla ya kurudisha katriji.',
        ],
        tip: 'Usitumie dawa ya kupauka, vifaa vya kusugua vinavyokwaruza, au sabuni kali. Vinaweza kuharibu plastiki isiyo na BPA na kubatilisha uthibitisho wako wa SGS.',
      },
      {
        heading: 'Uhifadhi',
        body: 'Ikiwa hutatumia chupa kwa zaidi ya wiki 2, ondoa katriji, isuuze kwa maji safi, na uiweke kwenye mfuko unaofungwa vizuri wa zip-lock ndani ya jokofu. Hii huzuia nyenzo ya kichujio kukauka na kupasuka. Kuhifadhi ikiwa kavu kunaweza kupunguza maisha ya kichujio.',
      },
    ],
  },
  'sweet-home-install': {
    titleSw: 'Sweet Home — mwongozo wa kufunga kichujio cha bomba',
    summarySw: 'Funga kichujio kwenye bomba la jikoni ndani ya dakika 5 — bila zana wala fundi wa mabomba.',
    sectionsSw: [
      {
        heading: 'Kabla ya kuanza',
        body: 'Sweet Home hufungwa kwenye uzi wa aereta (kifaa cha kuchanganya maji na hewa) kwenye ncha ya bomba la jikoni. Inafaa mabomba mengi ya kawaida (uzi wa nje wa milimita 22 au uzi wa ndani wa milimita 24). Angalia viunganishi vilivyomo kwenye kifurushi — viunganishi vinne vinafaa aina nyingi za mabomba nchini Kenya.',
        tip: 'Hujui utumie kiunganishi gani? Linganisha umbo la aereta yako ya sasa na michoro kwenye kadi ya kuanza haraka iliyo ndani ya kifurushi.',
      },
      {
        heading: 'Zana zinazohitajika',
        body: 'Hakuna. Sweet Home imeundwa kufungwa bila zana. Unaweza kutumia kitambaa kulinda uso wa bomba unapokaza kwa mkono.',
      },
      {
        heading: 'Hatua za kufunga',
        steps: [
          'Funga bomba kabisa.',
          'Ondoa aereta au wavu uliopo kwenye ncha ya bomba kwa kuuzungusha kinyume cha mwendo wa saa. Ikiwa umekaza sana, tumia kitambaa kushika vizuri — usitumie koleo, kwani linaweza kukwaruza uso wa bomba.',
          'Chagua kiunganishi sahihi na ukifunge kwenye ncha ya bomba kwa mkono. Kuzungusha kufuata mwendo wa saa = kukaza.',
          'Linganisha nyumba ya kichujio cha Sweet Home na kiunganishi, kisha isukume juu hadi uhisi imebofya kwenye kishikio.',
          'Fungua bomba polepole. Angalia kama maji yanavuja kwenye kiunganishi. Ukiona matone, funga bomba, ondoa kichujio, na uweke kiunganishi vizuri tena — hakikisha pete ya mpira ya O-ring imekaa mahali pake.',
          'Acha maji yatiririke kwa sekunde 30 ili kutoa hewa kwenye kichujio kipya.',
          'Chagua hali ya "Filtered" kwa kugeuza lever ya kubadili njia ya maji hadi nafasi ya kichujio (yenye alama ya tone). Lita 1–2 za kwanza hupita pembeni ya kichujio kiotomatiki ili kuondoa mabaki ya utengenezaji — baada ya hapo unapata maji safi yaliyothibitishwa.',
        ],
      },
      {
        heading: 'Kubadili kati ya maji yaliyochujwa na yasiyochujwa',
        body: 'Sweet Home ina kifaa cha kubadili njia ya maji, kinachokuwezesha kuchagua maji yaliyochujwa ya kunywa au maji yasiyochujwa yenye shinikizo kamili (ya kuosha vyombo au kujaza sufuria). Hali ya kuchuja ina shinikizo la chini — hii ni kawaida. Kichujio huondoa chembe na klorini, na hili huchukua muda kidogo zaidi.',
      },
      {
        heading: 'Vidokezo vya wiki ya kwanza',
        steps: [
          'Tumia upande wa maji yaliyochujwa kwa maji yote ya kunywa na kupikia.',
          'Tumia upande usiochujwa kuosha vyombo, kusuuza mboga, na kuchemsha maji.',
          'Fuatilia maisha ya kichujio katika programu ya Ultra Clear chini ya "My Filter" — programu itakukumbusha wakati wa kubadilisha ukifika.',
        ],
        warning: 'Usitumie Sweet Home kwa maji ya moto zaidi ya 38 °C. Maji ya moto yanaweza kuharibu nyenzo ya kichujio na kupunguza ufanisi wake. Daima acha maji baridi yatiririke kabla ya kubadili hadi hali ya kuchuja.',
      },
    ],
  },
  'shower-filter-install': {
    titleSw: 'Kufunga kichujio cha bafu na kubadilisha katriji',
    summarySw: 'Funga kichujio chako cha bafu ndani ya dakika chache na ufurahie maji yasiyo na klorini, yaliyothibitishwa na SGS, kila unapooga.',
    sectionsSw: [
      {
        heading: 'Unachohitaji',
        body: "Nyumba ya kichujio, katriji iliyowekwa tayari, na kitambaa kidogo. J'adore, Derma Care, na Pure Drop zote hutumia uzi wa kawaida wa kichwa cha bafu (1/2 inch BSP) unaofaa 99% ya mabomba ya kushikilia vichwa vya bafu nchini Kenya.",
      },
      {
        heading: 'Kufunga',
        steps: [
          'Zima maji ya bafu au hakikisha bomba la kuchanganya maji limefungwa kabisa.',
          'Ondoa kichwa cha bafu kilichopo kutoka kwenye bomba linalotoka ukutani. Zungusha kinyume cha mwendo wa saa.',
          'Kagua uzi wa bomba la bafu. Zungushia tepu ya PTFE ya fundi wa mabomba mara 2–3 ukifuata mwendo wa saa ili kuzuia maji kuvuja — tepu ipo kwenye kifurushi.',
          'Funga sehemu ya kuingizia maji ya nyumba ya kichujio kwenye bomba la bafu kwa mkono. Kaza vizuri kwa mkono — robo mzunguko mmoja wa ziada kwa kutumia kitambaa kushika inatosha. Usikaze kupita kiasi.',
          'Rudisha kichwa chako cha bafu kwenye sehemu ya kutolea maji ya nyumba ya kichujio. Uzi wa sehemu hiyo unalingana na kiwango cha kawaida cha bomba la bafu.',
          'Fungua maji polepole na uangalie kama yanavuja kwenye viunganishi vyote viwili.',
          'Acha maji ya bafu yatiririke kwa nguvu kamili kwa sekunde 60 ili kusuuza katriji mpya.',
        ],
        tip: 'Kwa kichujio cha beseni la kunawia uso cha Channel: njia ya kufunga ni sawa lakini huunganishwa kati ya ncha ya bomba na aereta ya beseni, kama Sweet Home. Angalia mwongozo wa Sweet Home ikiwa unahitaji msaada wa kiunganishi.',
      },
      {
        heading: 'Kichujio huondoa nini',
        body: 'Nyenzo za tabaka nyingi (PP Cotton → KDF → Activated Carbon → Vitamin C) huondoa >95% ya klorini huru, hupunguza metali nzito, na hupunguza athari za kloramini zilizobaki. Hizi ndizo sababu kuu za ngozi kukauka, nywele kukatika kwa urahisi, na ngozi ya kichwa kuwashwa kutokana na maji ya bomba ya Nairobi.',
      },
      {
        heading: 'Matunzo',
        body: 'Hakuna matunzo ya kila siku yanayohitajika. Kichujio ni kifaa kilichokamilika ndani yake. Kila baada ya miezi 5 (au ukiona shinikizo la maji kupitia kichujio limepungua), badilisha katriji. Angalia mwongozo wa kubadilisha kichujio.',
      },
    ],
  },
  'bottle-cartridge-swap': {
    titleSw: 'Jinsi ya kubadilisha katriji ya kichujio cha chupa',
    summarySw: 'Dumisha uthibitisho wako — badilisha katriji ya Ahlstrom Disruptor® kila baada ya lita 150 au miezi 3.',
    sectionsSw: [
      {
        heading: 'Wakati wa kubadilisha',
        body: 'Katriji ya chupa inapaswa kubadilishwa kila baada ya lita 150 za maji yaliyochujwa au miezi 3 — chochote kinachotangulia. Dalili za wakati wa kubadilisha: maji kupita polepole zaidi kwenye sehemu ya kunywea, ladha kubadilika, au kifuatiliaji cha kichujio katika programu ya Ultra Clear kuonyesha kikumbusho cha kubadilisha.',
      },
      {
        heading: 'Kupata katriji sahihi',
        body: 'Tumia katriji halisi ya kichujio cha chupa cha Ahlstrom Disruptor® (SKU: UC-RPL-BTL-010). Katriji hii inafaa aina zote za chupa za Ultra Clear. Katriji za watengenezaji wengine hazijathibitishwa na SGS na huenda zisiondoe vijidudu vya kusababisha magonjwa kwa kiwango sawa.',
      },
      {
        heading: 'Hatua za kubadilisha',
        steps: [
          'Mwaga maji yote yaliyobaki kwenye chupa.',
          'Fungua kifuniko kabisa na ukiweke kando.',
          'Shika sehemu ya juu ya katriji na uivute moja kwa moja juu. Itatoka ikiwa na ukinzani kidogo — hii ni kawaida.',
          'Tupa katriji ya zamani. Inaweza kutupwa salama pamoja na taka za kawaida.',
          'Fungua kifurushi cha katriji mpya na uhakikishe pete ya mpira ya O-ring ipo mahali pake juu.',
          'Ingiza katriji mpya kwenye sehemu ya chini ya chupa, ukilinganisha vichupo vyake. Sukuma chini kwa nguvu hadi uhisi au usikie imekaa mahali pake.',
          'Jaza chupa kwa maji, funga kifuniko, na upitishe maji ya chupa 2 zilizojaa kama ilivyoelezwa katika mwongozo wa kuanza kutumia chupa.',
        ],
        tip: 'Unabadilisha asubuhi? Jaza chupa usiku uliotangulia na uiache imesimama — katriji hujiandaa kwa kulowana usiku kucha na maji yatapita kwa urahisi kuanzia funda la kwanza.',
      },
      {
        heading: 'Sasisha kifuatiliaji cha kichujio',
        body: 'Baada ya kubadilisha, fungua programu ya Ultra Clear → kichupo cha Account → My Filter → gusa "Replaced today". Programu itaanza upya kuhesabu muda wa matumizi na kukukumbusha wakati wa kubadilisha tena.',
      },
    ],
  },
};