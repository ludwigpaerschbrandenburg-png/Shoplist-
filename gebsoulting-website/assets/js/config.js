/*
 * Gebsoulting – zentrale Unternehmensdaten.
 * Alles, was in eckigen Klammern steht, vor dem Livegang ersetzen.
 * Die Werte erscheinen automatisch überall auf der Seite (Kontakt, Footer, Impressum, Datenschutz).
 */
window.GEBSOULTING_CONFIG = {
  legalName: "Gebsoulting [Rechtsform, z. B. GmbH]",
  representative: "[Vorname Nachname], Geschäftsführung",
  email: "kontakt@gebsoulting.de",
  phone: "+49 [Vorwahl] [Nummer]",
  address: ["[Straße Hausnummer]", "[PLZ Ort]", "Deutschland"],
  hours: "Mo–Fr, 9–18 Uhr",
  register: "[Registergericht], [HRB-Nummer]",
  vatId: "[DE000000000]",

  /*
   * Kontaktformular:
   * - Leer lassen ("") → das Formular öffnet eine vorbereitete E-Mail an die Adresse oben.
   * - Endpoint eines Formular-Dienstes eintragen (z. B. Formspree: "https://formspree.io/f/xxxxxxx")
   *   → Anfragen werden direkt verschickt, ohne E-Mail-Programm.
   */
  formEndpoint: "",

  // true zeigt den Hinweis "Platzhalter" bei Deals und Team. Auf false setzen, sobald echte Inhalte drin sind.
  showPlaceholderNotice: true
};
