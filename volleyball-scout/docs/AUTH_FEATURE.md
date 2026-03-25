# Login & gebruikersbeheer (feature toggle)

## Overzicht

Met de auth-feature kunnen gebruikers inloggen via Google of Facebook. De feature wordt aan/uit gezet via configuratie (geen UI).

**Feature uit (standaard):** De app gedraagt zich zoals voorheen. Iedereen ziet alle wedstrijden en overzichten.

**Feature aan:**
- **Gasten** kunnen nieuwe wedstrijden starten en scouten, maar zien geen doorlopende wedstrijden en geen wedstrijdenoverzicht.
- **Ingelogde gebruikers** beheren hun teams en zien alleen wedstrijden van hun eigen teams in de overzichten.

## Login-opties

1. **E-mail + wachtwoord** – Eigen account aanmaken via "Account aanmaken". Geen externe diensten nodig.
2. **Google** – OAuth-login (optioneel, zie configuratie)
3. **Facebook** – OAuth-login (optioneel, zie configuratie)

## Wachtwoord vergeten

Gebruikers met een e-mailaccount kunnen via "Wachtwoord vergeten?" op de loginpagina een reset-link aanvragen. De link wordt per e-mail verstuurd en is 60 minuten geldig (configureerbaar in `config/auth.php`). De e-mail wordt verzonden via PHP `mail()`; configureer eventueel `mail_from` in `config/auth.php` voor de afzender.

## Feature inschakelen

In `config/app.php`:

```php
'feature_auth_enabled' => true,
```

## OAuth configuratie (optioneel)

E-mail login werkt direct. Voor Google/Facebook:

1. Kopieer `config/auth.php.example` naar `config/auth.php`.
2. Vul `base_url` in (bijv. `http://localhost:8080/volleyball-scout` of je productie-URL).
3. **Google:** Maak OAuth 2.0 credentials aan in [Google Cloud Console](https://console.cloud.google.com/apis/credentials). Redirect URI: `{base_url}/auth/callback.php?provider=google`. Vul `client_id` en `client_secret` in.
4. **Facebook:** Maak een app aan in [Facebook Developers](https://developers.facebook.com/). Vul `app_id` en `app_secret` in. Redirect URI: `{base_url}/auth/callback.php?provider=facebook`.

## Data

- `data/users.json` – gebruikersgegevens na eerste login
- `data/user_teams.json` – koppeling gebruiker ↔ teamnamen
- `data/password_reset_tokens.json` – tijdelijke tokens voor wachtwoordreset (wordt automatisch aangemaakt)
- Bij opslaan van een wedstrijd wordt het thuis-team automatisch aan de gebruiker gekoppeld.

## Feature uitzetten

Zet in `config/app.php`:

```php
'feature_auth_enabled' => false,
```

De app valt direct terug op het oude gedrag. Geen andere wijzigingen nodig.
