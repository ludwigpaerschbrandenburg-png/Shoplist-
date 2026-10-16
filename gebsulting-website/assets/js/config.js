/*
 * Gebsulting – zentrale Unternehmensdaten.
 * Alles, was in eckigen Klammern steht, vor dem Livegang ersetzen.
 * Die Werte erscheinen automatisch überall auf der Seite (Kontakt, Footer, Impressum, Datenschutz).
 */
window.GEBSULTING_CONFIG = {
  legalName: "Gebsulting [Rechtsform, z. B. GmbH]",
  representative: "Paul Gebhardt (CEO)",
  email: "kontakt@gebsulting.de",
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

  // true zeigt den Hinweis "Beispiel" bei Platzhalter-Deals. Auf false setzen, sobald echte Deals drin sind.
  showPlaceholderNotice: true
};
