# NetLab – Network Training Platform

Lern- und Planungsplattform für Cisco-Netzwerke, komplett im Browser (eine einzelne HTML-Datei, kein Backend).

## Inhalt

- **Labs (16)** – CLI-Übungen mit automatischer Bewertung: IOS-Grundlagen, Subnetting, VLANs, Trunks, Router-on-a-Stick, statisches Routing, Layer-3-Switch, ACLs, Switch-Härtung, 802.1X/MAB, ISE-Policy, SSL-Inspection, IPsec-VPN (IKEv2), Abschlussprojekt.
- **Netzplaner** – Netz aus echter Hardware bauen (Catalyst, ISR, ASA, MDS-FC, Huawei-Server, OceanStor-Storage), Port für Port verkabeln (Kupfer, Glasfaser, DAC, Transceiver), Rack-Ansicht, Packet-Tracer-artige Palette, Echtzeit- und Simulationsmodus mit Paketanimation.
- **Apps & Dienste** für PCs und Server: IP-Konfiguration (inkl. DHCP), Eingabeaufforderung, Webbrowser, Texteditor; HTTP, DNS, DHCP.
- **Aufgaben** – Aufbau- und Fehlersuche-Szenarien mit live abgehakten Zielen.
- **Ausfall-Simulation** (Gerät ausschalten, Kabel ziehen), Rückgängig/Wiederholen.
- **Export** – Gerätekonfigurationen (IOS/IOS-XE, ASA, MDS-Zoning), Hardware-Blätter für Server/Storage, Patchliste (CSV).

## Aufbau

```
src/engine.js    Simulationskern: L2/L3, VLAN, Trunks, ACL, NAT, IPsec, Firewall, Hardware-Physik, CLI
src/labs.js      Lab-Definitionen, Aufgaben und Musterlösungen
src/sandbox.js   Netzplaner (UI), Apps/Dienste, Aufgaben-Szenarien, Lint und Export
src/app.js       Startseite, Lab-Ansicht, Routing
src/shell.html   HTML-Gerüst und Styles
build.py         fügt src/ zu dist/netlab.html zusammen
tests/           Node-Tests für Labs, Apps/DNS/DHCP, Internet-Anbindung und Szenarien
dist/netlab.html fertig gebaute Version (direkt im Browser öffnen)
```

## Entwickeln

```bash
npm run build   # erzeugt dist/netlab.html
npm test        # Labs, Apps, Internet, Szenarien (Musterlösung muss alle Ziele erfüllen)
```

Voraussetzungen: Node.js und Python 3. Die gebaute Datei lädt nur Schriftarten von Google Fonts und JSZip (für den ZIP-Export) von cdnjs; alles andere läuft lokal. Fortschritt und Projekte speichert der Browser per `localStorage`.

## Hinweise

Der Simulator bildet Cisco IOS/IOS-XE und ASA vereinfacht nach. Slot-Zahlen und Standardbestückung der Huawei-Geräte sind Planungsannahmen – vor einer Bestellung mit dem Datenblatt abgleichen. Exportierte Konfigurationen sind Vorlagen: Passwörter, Keys, Interface-Namen und WWPNs vor dem Rollout prüfen.
