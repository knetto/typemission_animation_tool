# 🕵️ Transmission Studio — Super Spy School

Een complete studio voor het maken van geheime transmissie-video's voor **Super Spy School**.
Kies bij een nieuw project **Audio Terminal** of **File Terminal**. Bewerk je stem en geluiden, of maak een geanimeerde bestandsverkenner met afbeeldingen. Exporteer een MP4-video in 1080p of 4K, of alleen audio als WAV / MP3.

---

## 🚀 Snel starten

1. Open PowerShell in deze map:
   ```powershell
   npm start
   ```
2. Open je browser op:
   ```
   http://localhost:3000
   ```

*(De oude standalone versie blijft altijd beschikbaar via `http://localhost:3000/legacy` of `index.html`)*

---

## ✨ Functies

### Airline Website & Ticket (afbeeldingen)
Kies bij **Nieuw project** voor **Airline Website & Ticket**. Maak een fictieve airline-homepage met zichtbare taalvlaggen en een zelfgetekende Berlijn-illustratie, of een bijpassende boardingpass. De Dom, Fernsehturm, Brandenburger Tor en Spree worden scherp op elke exportresolutie getekend, met één doorlopend kleurverloop van donkerblauw naar lichtblauw. De skyline blijft zichtbaar boven het zoekformulier. De standaardnaam is **Airline**. De homepage toont drie aanpasbare vluchtkeuzes die dezelfde route gebruiken als het zoekformulier. Vlucht 1 levert de gegevens voor de boardingpass.

Kies **EN, NL, FR, DE of ES** via de taalkeuze of klik op een vlag in het voorbeeld. De homepage en boardingpass worden vertaald en het vertrekpunt wordt Londen, Amsterdam, Parijs, Frankfurt of Madrid. Alle teksten blijven aanpasbaar via **Alle teksten aanpassen**; eigen teksten worden per taal onthouden. Je kunt daarna ook een ander vertrekpunt invullen of een vertrekpreset kiezen. Aangepaste vluchtgegevens, namen en eigen datumnotaties blijven behouden bij het wisselen van taal.

Onder **Reiziger & ticket** kies je **Volwassene** of **Kind**. Het zoekformulier toont de passende reiziger en de boardingpass vermeldt het tickettype, automatisch vertaald met de taalvlag. De keuze wordt in het project opgeslagen. Bestaande projecten gebruiken standaard Volwassene; prijzen blijven vrij instelbaar.

Exporteer elk ontwerp als **PNG** of **JPG**, op standaardresolutie of extra scherp (2×). De homepage is 1920 × 1080 of 3840 × 2160 pixels; de boardingpass is 1600 × 800 of 3200 × 1600 pixels. Exports worden gedownload en blijven in het project beschikbaar. De Berlijn-illustratie wordt rechtstreeks op canvas getekend; externe afbeeldingen of lettertypen zijn niet nodig.

### 1. 📁 Projecten & Bestanden
- **Projectenbeheer**: Maak nieuwe missies/projecten aan, hernoem, dupliceer of verwijder ze.
- **Projecttype**: Audio Terminal voor de multitrack audio-editor; File Terminal voor afbeeldingen, mappen en automatische navigatie. Bestaande projecten blijven Audio Terminal projecten.
- **Audio uploaden**: Sleep één of meerdere audiobestanden tegelijk in het project (WAV, MP3, M4A, OGG, WebM).
- **Microfoonopname**: Neem direct in de browser spraakberichten op met ingebouwde tijdsweergave.
  > *Opmerking Bluetooth-headsets*: tijdens actief opnemen schakelt Windows tijdelijk naar de headset/handsfree-modus. Het afspelen en bewerken in Transmission Studio gebruikt veilige offline decoding zodat je Bluetooth-headset verbonden blijft!

### 2. 🎛️ Multitrack Audio Editor
- **Sporen**: Begin met één audiospoor. Voeg extra sporen toe wanneer je ze nodig hebt, elk met volume, dempen en solo.
- **Audioblokken**: Gekleurde blokken met naam, duur en golfvorm. Een duidelijke rand en vinkje tonen je selectie.
- **Clipinstellingen**: Volume en stemeffect direct in beeld; timing, fades en extra bewerkingen zijn uitklapbaar.
- **Instelbare zijpanelen**: Sleep de verticale grepen naast de bibliotheek en clipinstellingen om de breedte aan te passen. De studio onthoudt je voorkeur. Gebruik de pijltjestoetsen op een greep voor precieze stappen, of dubbelklik om de standaardbreedte te herstellen. Op mobiel staan de panelen onder elkaar.
- **Rechtermuisknop**: Pas clips aan, hernoem, knip, kopieer, plak, dupliceer, splits of verwijder ze. Klik met rechts op een lege plek om daar te plakken.
- **Knippen & Splitsen**:
  - Druk op <kbd>S</kbd> of klik op **Splitsen** om een clip precies bij de afspeelkop in tweeën te knippen.
  - Trim clips aan het begin of einde via de handvatten.
- **Bewerkingen**:
  - **⟲ Omdraaien (reverse)**: Speel audio achterstevoren af.
  - **Snelheid**: Pas afspeelsnelheid aan van 0.5× tot 2.0× met automatische lengteaanpassing.
  - **Toonhoogte (pitch)**: Verhoog of verlaag met halve tonen (-12 tot +12).
  - **Fade in / Fade out**: Vloeiende overgangen met visuele fade-curves.
  - **🧹 Stiltes verwijderen**: Detecteert automatisch stiltes en knipt pauzes er direct tussenuit.
  - **🧩 Samenvoegen (bounce)**: Voeg meerdere clips en effecten samen tot één nieuw audiobestand.
- **Sneltoetsen**:
  - <kbd>Spatie</kbd>: Afspelen / pauzeren
  - <kbd>S</kbd>: Splitsen
  - <kbd>Delete</kbd>: Geselecteerde clip(s) verwijderen
  - <kbd>Ctrl</kbd> + <kbd>Z</kbd> / <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd>: Ongedaan maken / Opnieuw
  - <kbd>Ctrl</kbd> + <kbd>D</kbd>: Dupliceren
  - <kbd>Ctrl</kbd> + <kbd>C</kbd> / <kbd>X</kbd> / <kbd>V</kbd>: Kopiëren / knippen / plakken op de afspeelkop binnen het project
  - <kbd>Ctrl</kbd> + <kbd>A</kbd>: Alles selecteren
  - <kbd>Ctrl</kbd> + <kbd>Scroll</kbd>: Tijdlijn in- en uitzoomen

### 3. 🎭 Stemeffecten (Voice FX)
Selecteer een clip en kies uit 27 effecten plus de originele stem. Kies eerst een klank, vergelijk **Origineel** en **Met effect** op de eerste zes seconden van je eigen clip, stel de **Sterkte** in en klik op **Toepassen**. Annuleren verandert je clip niet.
- De ruime effectenbibliotheek opent als een gecentreerd dialoogvenster: links zoek je en blader je door klanken; rechts staan de geselecteerde klank, sterkte en luistervoorbeelden. De keuze wordt pas opgeslagen na toepassen.
- **Basis**: Originele stem, Studio / helder en Presentator / warm.
- **Radio & Portofoon**: Digitale portofoon, Oude AM-radio, FM-radio / omroep, Meldkamer, Walkie-talkie (met korte ruis & eindpiep), Militaire veldradio, Beschadigde radio en Subtiele radio.
- **Telefoon**: Normaal mobiel gesprek, HD / modern mobiel, Mobiel jaren 90, Speakerstand, Voicemail, Klassieke vaste lijn, Vintage draaitelefoon, Slechte ontvangst en Subtiele telefoon.
- **Karakter**: Robot (ringmodulator comb-filter), Computer / AI, Alien, Diepe stem, Hoge stem, Spion-versleuteld (glitchy data-encryptie).
- **Ruimte**: Echo (delay met feedback), Galm / Hal (reverb).
- Pas direct toe op een enkele clip of met één klik op het **hele spoor**.
- **Vergelijken en herstellen**: Voorbeluister ook vanuit de clipinstellingen; verwijder het effect met één knop. Toepassen en verwijderen ondersteunen ongedaan maken en opnieuw.
- **Audioverwerking**: Afgestemde frequentiebanden, zachte compressie, oversampled verzadiging, spraakvolgende lijnruis en volumevergelijking met ruimte voor pieken. Bestaande preset-ID's blijven beschikbaar voor opgeslagen projecten.

De telefoonklanken zijn simulaties; ze implementeren geen mobiele spraakcodec. De klassieke en HD-varianten gebruiken verschillende frequentiebanden, geïnspireerd door het onderscheid tussen conventionele en breedbandtelefonie in [ITU-T P.341](https://www.itu.int/epublications/publication/itu-t-p-341-2011-03-transmission-characteristics-for-wideband-digital-loudspeaking-and-hands-free-telephony-terminals). Offline filters, compressie en verzadiging gebruiken de [Web Audio API](https://www.w3.org/TR/webaudio-1.0/).

### 4. 🔊 Sound Effects Bibliotheek
- **24 Ingebouwde effecten**:
  - TV: CRT opstarten, CRT afsluiten, Glitch, TV-storing, Klik.
  - Radio: Squelch (kssht), Roger-beep, Radio-storing.
  - Computer: Piep, Dubbele piep, Data-chirp, Typen, Succes, Fout, Opstarten, Uitschakelen.
  - Alarm: Sirene, Waarschuwingspiep.
  - Cinematic: Whoosh, Riser, Impact.
  - Telefoon: Rinkelen, Kiestoon, Ophangen.
- **Eigen sound effects**: Upload je eigen geluiden; ze worden opgeslagen in de centrale SQLite database en zijn direct beschikbaar in elk project.
- **Overzichtelijke mappen**: In- en uitvouwen per map of voor alle zichtbare mappen, ook tijdens zoeken. De dashboardbibliotheek en editor delen de opgeslagen mapstatus; zoeken toont tijdelijk passende resultaten.
- **Toegankelijke bediening**: Mapknoppen werken met Enter en Spatie. Favorieten, uploads en opties hebben herkenbare knoppen; de zijbalk past ook op smalle schermen.

### 5. 🎬 Export: video of alleen audio
Klik na het bewerken op **Export**. Kies **Video met scène** voor MP4, of **Alleen audio** voor WAV (48 kHz, 16-bit PCM) / MP3 (320 kbps). Audio-only bevat je bewerkte tijdlijn met stemeffecten en sound effects, zonder scene-intro, afsluiting of extra scenegeluiden. Het volume van de tijdlijn blijft behouden.

Voor een Audio Terminal video kies je een scène:
1. **Incoming Transmission**: Blauw TV-scherm met scanlines, 1:1 spionlogo en dynamische audiometer (met zachte ronde dots).
2. **Urgent / Hoofdkwartier**: Rood knipperend alarm met waarschuwingsdriehoek en pulserend URGENT. Optie om het logo blauw te houden.
3. **AI / Computer**: Siri-achtige gloeiende orb met vloeibare reactieve audio-blobs en S.S.S. AI-Core label.
- **Aanpasbaar**: Eigen titelbalktekst, HUD-raster/radar aan/uit, TV-geluidseffecten en volume, pauzes voor en na.
- **Directe MP4 export**: Geen externe screenrecorder meer nodig! Rendert frame-voor-frame via browser WebCodecs (H.264) en voegt server-side direct 48 kHz AAC audio toe.
- **Audiometer**: Het dBFS-getal en de animatie volgen de uiteindelijke soundtrack, inclusief clipvolume, effecten en de laatste volumeaanpassing. De RMS-meting gebruikt de afgelopen 50 ms audio; stilte toont `−∞ dBFS`. Preview en MP4-export gebruiken dezelfde meting.
- Keuze uit **1080p Full HD** of **4K Ultra HD**, op **30 FPS** of **60 FPS**.

### 6. 📂 File Terminal
- **Engelse interface**: De bestandsverkenner, instellingen, dialoogvensters en exportbediening zijn in het Engels. Je eigen bestandsnamen en mapnamen worden behouden.
- **Bestandsverkenner**: Maak mappen, upload JPG / PNG / WebP (maximaal 30 MB per afbeelding) en verplaats afbeeldingen naar een map. Dubbelklik op een afbeelding om deze groot te bekijken.
- **Volgorde**: Sleep afbeeldingen in de afspeelvolgorde of gebruik de pijlen. De video volgt deze volgorde, ook als de sequence tussen mappen wisselt.
- **Tijdstempels**: Onder de afspeelbalk staan de bestandsnamen met hun opentijd. Klik op een tijdstempel om direct naar de afbeelding te springen; de tooltip toont het hele zichtbare tijdvak. De actieve afbeelding licht op en wordt onder de balk benoemd.
- **Hernoemen**: Gebruik **Rename** naast de actieve afbeelding of het potloodje in de afspeelvolgorde. De naam verandert ook in de verkenner, login-intro en export; je previewpositie blijft behouden.
- **Rustige navigatie**: De muis volgt gebogen paden met vloeiende versnelling en vertraging, zonder te verspringen bij het openen of sluiten. Mappen, afbeeldingen en de sluitknop lichten op tijdens een korte hoverpauze voor de klik. **Navigation pace** biedt Brisk, Relaxed (standaard) en Extra relaxed. Dit verandert de navigatietijd, niet de ingestelde kijktijd van de afbeeldingen.
- **Kijktijd**: Standaard 3 seconden per afbeelding; instelbaar van 0,5 tot 60 seconden. Navigatie, openen en sluiten komen bovenop deze kijktijd. Afbeeldingen worden volledig getoond met behoud van hun verhoudingen.
- **Muisvariatie**: Iedere beweging krijgt een eigen kromming en snelheidsverloop. **Shuffle mouse paths** maakt een nieuwe, opgeslagen variatie; terugspoelen, preview en export volgen steeds dezelfde paden.
- **Twee thema's**: Hacker (zwart en groen) en Classic (blauw en wit).
- **Login-intro**: Standaard aan. Een geanimeerde terminal toont System Login, een instelbare gebruikersnaam, een gemaskeerd wachtwoord en de bestandsnamen voordat de verkenner opent. Je kunt de intro uitschakelen.
- **Logout-outro**: Optioneel via **Show logout outro** (standaard uit). Na de laatste afbeelding sluit de verkenner, wordt uitgelogd en de terminal gewist. Beide thema's eindigen met een volledig zwart, leeg beeld en stilte. De outro staat ook op de tijdsbalk.
- **Navigatiegeluiden**: Gesynthetiseerde mechanische muisklikken en toetsen, plus korte interfacegeluiden bij het openen van mappen en afbeeldingen. Volume instelbaar; alle geluiden kunnen worden uitgezet.
- **Preview en export**: Dezelfde vaste sequence bepaalt muisbewegingen, dubbelklikken, mapwissels, beeld en geluid. Exporteer als MP4 (1080p / 4K, 30 / 60 FPS) of alleen de sequencegeluiden als WAV / MP3.

---

## 🗄️ Opslag & Database
- Database: `storage/studio.db` (SQLite via Node's ingebouwde `node:sqlite`)
- Audio: `storage/audio/`
- Afbeeldingen: `storage/images/`
- Sound effects: `storage/sfx/`
- Exports: `storage/exports/`

Bij het Gehackt Scherm gebruikt een transparante export standaard **WebM** (VP9 met alpha en Opus-geluid) voor kleine bestanden. **MOV / ProRes 4444** blijft beschikbaar voor montageprogramma's die dit nodig hebben, maar maakt veel grotere bestanden. Ondersteunt je montageprogramma geen WebM met transparantie, kies dan MOV of exporteer MP4 met een groene achtergrond om te keyen. Bestaande exports veranderen niet; maak een nieuwe export om het compacte formaat te gebruiken.
