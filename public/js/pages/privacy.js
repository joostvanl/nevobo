export function render(container) {
  container.innerHTML = `
    <div class="page-hero">
      <div class="container">
        <button class="btn" style="background:rgba(255,255,255,0.2);color:#fff;margin-bottom:0.75rem"
          onclick="history.back()">← Terug</button>
        <h1>🔒 Privacy & AVG</h1>
        <p style="opacity:0.85;font-size:0.9rem">Laatst bijgewerkt: maart 2026</p>
      </div>
    </div>

    <div class="container" style="max-width:680px;padding-bottom:3rem">

      <div class="card mb-3">
        <div class="card-body">
          <h2 style="font-size:1.1rem;margin-bottom:0.75rem">Wie zijn wij?</h2>
          <p style="font-size:0.9rem;line-height:1.6">
            Deze applicatie wordt beheerd door <strong>VTC Woerden</strong> en is uitsluitend bedoeld
            voor leden, ouders en begeleiders van de bij de club aangesloten volleybalteams.
            De app is niet publiek toegankelijk.
          </p>
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-body">
          <h2 style="font-size:1.1rem;margin-bottom:0.75rem">Welke gegevens verwerken wij?</h2>
          <p style="font-size:0.9rem;line-height:1.6;margin-bottom:0.75rem">
            Wij verwerken de volgende persoonsgegevens (PII):
          </p>
          <ul style="font-size:0.9rem;line-height:1.8;padding-left:1.25rem">
            <li><strong>Naam en e-mailadres</strong> — voor aanmelding en communicatie</li>
            <li><strong>Geboortedatum</strong> — voor leeftijdsverificatie bij teamindelingen</li>
            <li><strong>Shirtnummer en positie</strong> — voor teamadministratie</li>
            <li><strong>Profielfoto</strong> — optioneel, door jezelf geüpload</li>
            <li><strong>Foto's en video's</strong> — door jou zelf geüpload bij wedstrijden</li>
          </ul>
          <p style="font-size:0.9rem;line-height:1.6;margin-top:0.75rem">
            Wij verwerken <strong>geen</strong> betaalgegevens, locatiedata of bijzondere categorieën
            persoonsgegevens (zoals gezondheid of nationaliteit).
          </p>
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-body">
          <h2 style="font-size:1.1rem;margin-bottom:0.75rem">Op welke grondslag?</h2>
          <p style="font-size:0.9rem;line-height:1.6">
            De verwerking van jouw gegevens is gebaseerd op <strong>toestemming</strong> (AVG art. 6 lid 1 sub a)
            en het <strong>gerechtvaardigde belang</strong> van de club om haar leden te administreren
            (AVG art. 6 lid 1 sub f). Door je te registreren ga je akkoord met deze verwerking.
          </p>
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-body">
          <h2 style="font-size:1.1rem;margin-bottom:0.75rem">Wie heeft toegang?</h2>
          <ul style="font-size:0.9rem;line-height:1.8;padding-left:1.25rem">
            <li><strong>Jijzelf</strong> — altijd inzage in je eigen gegevens via je profiel</li>
            <li><strong>Teambeheerders</strong> — shirtnummer, positie, geboortedatum en e-mail van hun teamleden</li>
            <li><strong>Clubbeheerders</strong> — overzicht van alle teamleden binnen de club</li>
            <li><strong>Opperbeheerder</strong> — volledige toegang voor technisch beheer</li>
          </ul>
          <p style="font-size:0.9rem;line-height:1.6;margin-top:0.75rem">
            Gegevens worden <strong>nooit</strong> gedeeld met derden of gebruikt voor commerciële doeleinden.
          </p>
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-body">
          <h2 style="font-size:1.1rem;margin-bottom:0.75rem">Hoe lang bewaren wij gegevens?</h2>
          <p style="font-size:0.9rem;line-height:1.6">
            Gegevens worden bewaard zolang je lid bent van de app. Na verwijdering van je account
            worden alle persoonsgegevens binnen <strong>30 dagen</strong> definitief verwijderd.
            Geüploade media (foto's/video's) worden direct verwijderd wanneer jij ze verwijdert.
          </p>
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-body">
          <h2 style="font-size:1.1rem;margin-bottom:0.75rem">Jouw rechten (AVG)</h2>
          <ul style="font-size:0.9rem;line-height:1.8;padding-left:1.25rem">
            <li><strong>Inzage</strong> — je kunt altijd opvragen welke gegevens wij van je hebben</li>
            <li><strong>Correctie</strong> — je kunt je gegevens zelf aanpassen via je profiel</li>
            <li><strong>Verwijdering</strong> — je kunt verzoeken je account en alle data te verwijderen</li>
            <li><strong>Bezwaar</strong> — je kunt bezwaar maken tegen de verwerking</li>
            <li><strong>Dataportabiliteit</strong> — je kunt een export van je gegevens opvragen</li>
          </ul>
          <p style="font-size:0.9rem;line-height:1.6;margin-top:0.75rem">
            Heb je vragen of wil je gebruik maken van je rechten? Stuur een e-mail naar de
            clubbeheerder of neem contact op via de teamapp.
          </p>
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-body">
          <h2 style="font-size:1.1rem;margin-bottom:0.75rem">Beveiliging</h2>
          <p style="font-size:0.9rem;line-height:1.6">
            Alle verbindingen zijn beveiligd met <strong>HTTPS/TLS</strong> via Cloudflare.
            Wachtwoorden worden opgeslagen als <strong>bcrypt-hash</strong> (nooit in leesbare tekst).
            Toegang tot persoonsgegevens is beperkt op basis van rollen (RBAC).
            De applicatie draait op een besloten netwerk en is niet publiek vindbaar.
          </p>
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-body">
          <h2 style="font-size:1.1rem;margin-bottom:0.75rem">Klachten</h2>
          <p style="font-size:0.9rem;line-height:1.6">
            Heb je een klacht over de verwerking van je persoonsgegevens? Je hebt het recht
            een klacht in te dienen bij de
            <a href="https://www.autoriteitpersoonsgegevens.nl" target="_blank" rel="noopener"
               style="color:var(--primary)">Autoriteit Persoonsgegevens</a>.
          </p>
        </div>
      </div>

    </div>`;
}
