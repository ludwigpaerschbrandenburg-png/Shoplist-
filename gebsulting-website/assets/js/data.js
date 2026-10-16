/*
 * Gebsulting – Inhalte, die sich oft ändern: Deals, Team, Kundengruppen.
 * Neue Deals einfach als weiteren Eintrag in die Liste schreiben.
 * Die ersten drei Deals erscheinen zusätzlich auf der Startseite.
 *
 * Felder eines Deals:
 *   art         – Filterkategorie, z. B. "Vision", "Umsatz", "Produktivität", "KI", "Kosten"
 *   partei      – Kunde (oder anonymisiert, z. B. "Familienunternehmen")
 *   aktion      – was passiert ist, z. B. "steigert Umsatz mit"
 *   gegenpartei – optional: Ergebnis oder Maßnahme
 *   rolle       – unsere Rolle
 *   branche, jahr – kurze Angaben für die Fußzeile der Karte
 *   platzhalter – true, solange es ein Beispiel-Eintrag ist
 */
window.GEBSULTING_DATA = {
  deals: [
    {
      art: "Vision",
      partei: "Inhabergeführtes Familienunternehmen",
      aktion: "richtet sich neu aus mit",
      gegenpartei: "Vision 2030",
      rolle: "Visionsentwicklung",
      branche: "Mittelstand",
      jahr: "2026",
      platzhalter: true
    },
    {
      art: "Umsatz",
      partei: "Regionaler Händler",
      aktion: "erschließt",
      gegenpartei: "neue Vertriebskanäle",
      rolle: "Umsatzstrategie",
      branche: "Handel",
      jahr: "2026",
      platzhalter: true
    },
    {
      art: "Produktivität",
      partei: "Dienstleistungsunternehmen",
      aktion: "steigert Produktivität durch",
      gegenpartei: "KI-Werkzeuge & neue Teamstruktur",
      rolle: "Workforce-Optimierung",
      branche: "Dienstleistung",
      jahr: "2026",
      platzhalter: true
    },
    {
      art: "KI",
      partei: "Start-up",
      aktion: "automatisiert",
      gegenpartei: "Kundenservice & Backoffice",
      rolle: "Einführung KI-Werkzeuge",
      branche: "Software",
      jahr: "2025",
      platzhalter: true
    },
    {
      art: "Kosten",
      partei: "Handwerksbetrieb",
      aktion: "senkt Kosten durch",
      gegenpartei: "Neuverhandlung von Verträgen",
      rolle: "Kostenoptimierung",
      branche: "Handwerk",
      jahr: "2025",
      platzhalter: true
    }
  ],

  team: [
    {
      name: "Paul Gebhardt",
      rolle: "CEO",
      text: "Führt Gebsulting und verantwortet die Zusammenarbeit mit unseren Kunden von der ersten Vision bis zum Ergebnis."
    },
    {
      name: "Nils Jabusch",
      rolle: "Senior Project Advisor",
      text: "Begleitet unsere Projekte in der Umsetzung und sorgt dafür, dass aus Plänen messbare Ergebnisse werden."
    },
    {
      name: "Ludwig Paersch",
      rolle: "Junior Vision Development Consultant",
      text: "Entwickelt gemeinsam mit unseren Kunden Visionen und übersetzt sie in konkrete Ziele."
    }
  ],

  kunden: [
    "Unternehmerinnen und Unternehmer",
    "Inhabergeführte Unternehmen",
    "Gründerinnen, Gründer und Start-ups",
    "Etablierte Unternehmen im Wandel",
    "Organisationen mit Effizienzdruck"
  ]
};
