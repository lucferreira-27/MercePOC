# More styles: what people ask for and what we added

Merce had seven styles (industrial, anos 60, escandinavo, minimalista, rústico, clássico, japandi). This note records which other furniture styles people search for, Brazil first and then globally, which ones we added and which we skipped.

## What the research shows

Brazil (Portuguese sources, decor retailers and Pinterest Predicts):

- Pinterest's 2025 trends for Brazil name **boho chic** next to scandinavian, industrial and minimalist as the most searched decor styles, plus "lar, eclético lar" (maximalism, vintage with modern, boho with chic) and rustic cottage retreats ([Meio & Mensagem](https://www.meioemensagem.com.br/midia/pinterest-predicts-2025), [CNN Brasil](https://www.cnnbrasil.com.br/lifestyle/descubra-as-tendencias-de-decoracao-para-2025-segundo-o-pinterest/), [Mundo do Marketing](https://mundodomarketing.com.br/detox-digital-e-estilo-boho-dominam-tendencias-pinterest-para-o-meio-do-ano)).
- Lists of the styles Brazilians like best put **tropical**, rústico, industrial, moderno, **boho**, clássico, minimalista, **praiano (coastal)** and eclético at the top ([Bucalo](https://www.bucalo.com.br/blog/post/conheca-os-estilos-de-decoracao-mais-queridos-no-brasil), [Archtrends, 21 estilos](https://blog.archtrends.com/estilos-de-decoracao/), [mm home&decor](https://mmartan.com.br/homeandlife/decoracao/conheca-10-estilos-de-decoracao-e-descubra-qual-e-o-seu/)).
- **Provençal** has its own big vocabulary in Brazilian furniture retail ("cozinha provençal", "quarto provençal", "mesa provençal"): white or pastel paint, patina, turned or cabriole legs, raised-panel doors ([Westwing, estilo provençal](https://www.westwing.com.br/guiar/estilo-provencal/), [Westwing, mesa provençal](https://www.westwing.com.br/guiar/mesa-provencal/), [Meu Móvel Planejado](https://meumovelplanejado.com/moveis-no-estilo-provencal-dicas/)). Merce only had it as a keyword that led to Clássico.
- **Brazilian modern design** (Sergio Rodrigues, Joaquim Tenreiro, Zanine Caldas) and "tropicalismo contemporâneo" keep coming back: freijó and jacarandá, palhinha, leather, pé palito ([ELLE Brasil](https://elle.com.br/elle-decoration/quem-foi-sergio-rodrigues-designer), [Westwing, pé palito](https://www.westwing.com.br/guiar/pe-palito/), [Tidelli](https://www.tidelli.com/pt-br/blogs/journal/tropicalismo-contemporaneo-na-decoracao-design-brasileiro-natureza-e-sofisticacao-em-harmonia), [Impress, freijó](https://blogbr.impress.biz/a-beleza-tropical-do-freijo/)).

Global:

- Google's Year in Search 2024 top interior styles: biophilic, modern colonial, mid-century, **art déco**, japandi, quiet luxury, Spanish revival, American colonial, **glam**, cottagecore ([BAM, from Google Year in Search](https://nowbam.com/most-searched-interior-design-styles-of-2024/)). The art déco revival and Hollywood Regency glam share the same furniture vocabulary: black or jewel lacquer, brass, mirrored or reeded glass, marble ([Westwing, móveis art déco](https://www.westwing.com.br/guiar/moveis-art-deco/), [Planner 5D](https://planner5d.com/blog/pt/decoracao-art-deco/), [Kevin Francis Design](https://kevinfrancisdesign.com/blogs/design-ideas/hollywood-regency-style-guide)).
- Coastal: white and sand with light blue, light wood, rattan, simple lines ([Westwing, casa de praia](https://www.westwing.com.br/guiar/casa-de-praia/), [Luisa Decor](https://www.luisadecor.com.br/decoracao-praia-criando-ambientes-com-o-estilo-coastal-decor)).

## What we added (five styles)

Each style is a row in `lib/styles.ts` built only from parts the engine already had. The one engine change: the turned leg (`turned`) now also goes under boxes (100 to 300 mm), so provençal can stand on it. Two sheet colors joined the catalog because two styles depend on a color we did not have: **Terracota** (boho) and **Azul claro** (praiano), both priced like the other painted sheets.

| Style (id) | Looks like | Body and fronts | Base | Handle | Fronts | Top and details | Keywords |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Boho (`boho`) | light natural wood, rattan and leather, earth tones, open shelves | carvalho | tapered oak leg (chunky oak block on tables) | leather strap (`strap`) | cane in a wood frame | oak top on counters; terracotta back in open niches, terracotta wall panel; open bookcase (`airy`) | boho, boêmio, rattan, vime, fibra natural, étnico, hippie |
| Brasileiro (`brazilian`) | Brazilian modernism: freijó and palhinha on thin solid legs, long and low | freijó | pé palito in solid freijó | routed groove (`groove`) | cane in a wood frame; sideboard with sliding cane doors | slatted freijó wall panel; low and long proportions | brasileiro, modernismo/modernista brasileiro, design brasileiro, tropical, palhinha, Sergio Rodrigues, Zanine, Tenreiro, jacarandá |
| Art déco (`artdeco`) | black lacquer with brass, reeded glass, marble | preto fosco | short brass tube leg | brass bar | reeded glass (`glass-ribbed`) in a black frame | white marble top with chamfered edge; LED in the glass cabinet; brass sled base on tables; Nero counter | art déco, glam, Hollywood, Gatsby, anos 20/30, luxo |
| Provençal (`provencal`) | French country: white paint, raised panels, turned legs, wood tops | branco | turned leg painted white | bronze knob | frame with raised panel (`framed`) | oak top on low pieces, counters and tables; cornice on tall and wall units, sage back | provençal, francês, campestre, romântico, shabby, pátina |
| Praiano (`coastal`) | beach house: white with light blue, light wood, louvred look | branco with azul claro fronts | square ash block leg | ash knob | slatted | ash top on low pieces and counters; white slatted wall panel | praiano, praia, casa de praia, coastal, litoral, beira-mar, navy, náutico, Hamptons |

Every pair of the twelve styles differs in at least two of legs, handle, front style, body and front material (`tests/styles.test.ts`), and every asset builds in every style across its size range.

Keyword matching now takes the longest keyword found, so "aparador modernista brasileiro" is brasileiro and not anos 60, and "cozinha provençal" now goes to Provençal instead of Clássico (Clássico keeps clássico, tradicional, colonial, neoclássico).

## What we skipped and why

- **Tropical**: in furniture it is the same vocabulary as Brazilian modern (freijó, palhinha, natural fibers); the difference is plants, prints and color in the room, which Merce does not draw. It is a keyword of Brasileiro.
- **Glam / Hollywood Regency**: same parts as art déco (lacquer, brass, mirror or glass). Folded into Art déco as keywords.
- **Farmhouse moderno, French country, colonial**: farmhouse is already a Rústico keyword, French country is Provençal, colonial stays with Clássico.
- **Wabi-sabi**: already a Japandi keyword; as furniture it is the same low, raw, handle-free look.
- **Transitional, contemporâneo, eclético**: not a recipe of parts. Transitional and contemporâneo sit between Clássico and Minimalista (contemporâneo is a Minimalista keyword); eclético means mixing styles, which per-piece styling already allows.
- **Memphis**: needs bright laminates, terrazzo and asymmetric shapes the engine does not build, and it is niche in Brazil.
- **Brutalist**: needs concrete, chunky carved volumes and raw metal; the box engine cannot express it honestly.
- **Biophilic, quiet luxury, cottagecore, Spanish revival**: room-level moods (plants, textiles, light, arches), not furniture recipes.
