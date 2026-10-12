global.NL = require('../src/engine.js'); global.window = undefined;
const SB = require('../src/sandbox.js');
const net = { devs: {}, links: [], seq: 1 }, api = SB.testApi(net), A = (m, h) => api.addDev(m, 0, 0, h);
const sw = A('C9200L-24P-4X', 'SW'), dc = A('Server', 'DC01'), fs = A('Server', 'FS01'), pc = A('PC', 'PC-1');
net.devs[dc].os = 'windows'; net.devs[fs].os = 'windows';
const G = 'GigabitEthernet1/0/', lk = (id, i) => net.links.push({ a: id, ap: 'eth0', b: sw, bp: G + i, cable: 'cu' }); lk(dc, 1); lk(fs, 2); lk(pc, 3);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const W = (h, l) => api.win(h, l), D = id => net.devs[id];
api.hostLine(D(pc), NL.newSess(), 'ip 10.0.0.20/24 10.0.0.1');
ok(api.winPrompt('DC01') === 'PS C:\\Users\\Administrator> ' && api.winPrompt('PC-1') === 'C:\\Users\\admin>', 'Prompts');
ok(/not recognized|nicht als Name/.test(W('DC01', 'Foo-Bar')), 'unbekanntes Cmdlet');

// Netzwerk
ok(/Keine Netzwerkschnittstelle/.test(W('DC01', 'New-NetIPAddress -InterfaceAlias LAN -IPAddress 10.0.0.10 -PrefixLength 24')), 'falscher Interface-Alias');
W('DC01', 'New-NetIPAddress -InterfaceAlias Ethernet0 -IPAddress 10.0.0.10 -PrefixLength 24 -DefaultGateway 10.0.0.1');
ok(D(dc).cfg.ip === '10.0.0.10' && D(dc).cfg.mask === '255.255.255.0' && D(dc).cfg.gw === '10.0.0.1', 'New-NetIPAddress setzt IP, Maske, Gateway');
W('FS01', 'New-NetIPAddress -InterfaceAlias Ethernet0 -IPAddress 10.0.0.30 -PrefixLength 24 -DefaultGateway 10.0.0.1');
ok(/Ethernet0/.test(W('DC01', 'Get-NetIPAddress')) && /10\.0\.0\.10\/24/.test(W('DC01', 'Get-NetIPAddress')), 'Get-NetIPAddress');
ok(/Reply|Antwort|!|Erfolgsrate|bytes/.test(W('PC-1', 'ping 10.0.0.10')), 'ping vom PC (Fallback)');

// Rollen / Forest
ok(/AD-Domain-Services ist nicht installiert/.test(W('DC01', 'Install-ADDSForest -DomainName lab.local')), 'Forest ohne Rolle abgelehnt');
ok(/Success/.test(W('DC01', 'Install-WindowsFeature -Name AD-Domain-Services -IncludeManagementTools')), 'Rolle AD DS installieren');
ok(/Install-WindowsFeature : Das Feature/.test(W('DC01', 'Install-WindowsFeature Quatsch')), 'unbekanntes Feature');
ok(/SafeModeAdministratorPassword fehlt/.test(W('DC01', 'Install-ADDSForest -DomainName lab.local -Force')), 'Forest ohne DSRM-Kennwort');
ok(/Komplexit/.test(W('DC01', 'Install-ADDSForest -DomainName lab.local -SafeModeAdministratorPassword (ConvertTo-SecureString "abc" -AsPlainText -Force)')), 'schwaches DSRM-Kennwort');
ok(/wurde erstellt/.test(W('DC01', 'Install-ADDSForest -DomainName lab.local -SafeModeAdministratorPassword (ConvertTo-SecureString "P@ssw0rd123" -AsPlainText -Force) -Force')), 'Forest lab.local erstellt');
ok(/NetBIOSName\s+: LAB/.test(W('DC01', 'Get-ADDomain')), 'Get-ADDomain');
ok(D(dc).svc.dns.on && D(dc).svc.dns.records.some(r => r.name === 'lab.local') && D(dc).cfg.dns === '10.0.0.10', 'DC: DNS-Rolle aktiv, Zone/Records, DNS = sich selbst');
ok(/DOMAIN-Fehler|Domänencontroller/.test(W('FS01', 'New-ADUser -Name X')) || /Active Directory Web Services/.test(W('FS01', 'New-ADUser -Name X')), 'AD-Cmdlets nur auf dem DC');

// Benutzer, Gruppen, OUs
ok(/Komplexit/.test(W('DC01', 'New-ADUser -Name "Max Muster" -SamAccountName mmuster -AccountPassword (ConvertTo-SecureString "geheim" -AsPlainText -Force) -Enabled $true')), 'schwaches Benutzerkennwort');
ok(W('DC01', 'New-ADUser -Name "Max Muster" -SamAccountName mmuster -AccountPassword (ConvertTo-SecureString "Sommer2026!" -AsPlainText -Force) -Enabled $true') === '', 'Benutzer angelegt');
W('DC01', 'New-ADUser -Name "Anna Beispiel" -SamAccountName abeispiel -AccountPassword (ConvertTo-SecureString "Winter2026!" -AsPlainText -Force) -Enabled $true');
ok(/mmuster/.test(W('DC01', 'Get-ADUser -Filter *')) && /abeispiel/.test(W('DC01', 'Get-ADUser -Filter *')), 'Get-ADUser -Filter *');
ok(/Name/.test(W('DC01', 'Get-ADUser -Filter * | Select-Object Name')) && !/SamAccountName/.test(W('DC01', 'Get-ADUser -Filter * | Select-Object Name')), 'Pipe: Select-Object');
ok(/mmuster/.test(W('DC01', "Get-ADUser -Filter \"SamAccountName -eq 'mmuster'\"")) && !/abeispiel/.test(W('DC01', "Get-ADUser -Filter \"SamAccountName -eq 'mmuster'\"")), '-Filter mit -eq');
ok(/GroupScope/.test(W('DC01', 'New-ADGroup -Name Vertrieb')), 'Gruppe braucht GroupScope');
W('DC01', 'New-ADGroup -Name Vertrieb -GroupScope Global'); W('DC01', 'Add-ADGroupMember -Identity Vertrieb -Members mmuster,abeispiel');
ok((W('DC01', 'Get-ADGroupMember -Identity Vertrieb').match(/mmuster|abeispiel/g) || []).length === 2, 'Gruppenmitglieder');
ok(/Kann kein Objekt/.test(W('DC01', 'Add-ADGroupMember -Identity Vertrieb -Members niemand')), 'unbekanntes Mitglied');
ok(/nicht gefunden/.test(W('DC01', 'New-ADUser -Name T -SamAccountName t1 -Path "OU=Sales,DC=lab,DC=local"')), 'OU muss existieren');
W('DC01', 'New-ADOrganizationalUnit -Name Sales'); ok(W('DC01', 'New-ADUser -Name Tim -SamAccountName tim -Path "OU=Sales,DC=lab,DC=local"') === '', 'Benutzer in OU');
W('DC01', 'Remove-ADUser -Identity tim'); ok(!/tim/.test(W('DC01', 'Get-ADUser -Filter *')), 'Remove-ADUser');

// Domaenenbeitritt
ok(/Credential/.test(W('PC-1', 'Add-Computer -DomainName lab.local')), 'Add-Computer braucht Credential');
const j1 = W('PC-1', 'Add-Computer -DomainName lab.local -Credential lab\\administrator'); ok(/konnte der Domäne/.test(j1) && /DNS/.test(j1), 'Join ohne DNS: Fehler mit DNS-Hinweis');
D(pc).cfg.dns = '10.0.0.99'; ok(/DNS/.test(W('PC-1', 'Add-Computer -DomainName lab.local -Credential lab\\administrator')), 'Join mit falschem DNS: Fehler');
W('PC-1', 'Set-DnsClientServerAddress -InterfaceAlias Ethernet0 -ServerAddresses 10.0.0.10'); ok(D(pc).cfg.dns === '10.0.0.10', 'Set-DnsClientServerAddress');
D(dc).win.svc.NTDS = 'Stopped'; ok(/NTDS/.test(W('PC-1', 'Add-Computer -DomainName lab.local -Credential lab\\administrator')), 'Join bei gestopptem NTDS: Fehler'); D(dc).win.svc.NTDS = 'Running';
ok(/WARNING/.test(W('PC-1', 'Add-Computer -DomainName lab.local -Credential lab\\administrator')) && D(pc).win.domain.name === 'lab.local', 'Join erfolgreich');
ok(/PC-1/.test(W('DC01', 'Get-ADComputer -Filter *')), 'Computerkonto auf dem DC');
ok(/lab\\admin/.test(W('PC-1', 'whoami')) && /Domain:\s+lab.local/.test(W('PC-1', 'systeminfo')), 'whoami und systeminfo zeigen die Domaene');
ok(/schon/.test(W('PC-1', 'Add-Computer -DomainName lab.local -Credential lab\\administrator')), 'doppelter Join abgelehnt');
W('FS01', 'Set-DnsClientServerAddress -InterfaceAlias Ethernet0 -ServerAddresses 10.0.0.10'); W('FS01', 'Add-Computer -DomainName lab.local -Credential lab\\administrator'); ok(D(fs).win.domain.role === 'member', 'FS01 Mitglied');

// DHCP mit Autorisierung
W('FS01', 'Install-WindowsFeature DHCP'); W('FS01', 'Add-DhcpServerv4Scope -Name LAN -StartRange 10.0.0.100 -EndRange 10.0.0.120 -SubnetMask 255.255.255.0'); W('FS01', 'Set-DhcpServerv4OptionValue -Router 10.0.0.1 -DnsServer 10.0.0.10'); W('FS01', 'Start-Service DHCPServer');
ok(!D(fs).svc.dhcp.on, 'DHCP in der Domaene ohne Autorisierung vergibt nichts');
W('FS01', 'Add-DhcpServerInDC'); ok(D(fs).svc.dhcp.on && D(fs).svc.dhcp.start === '10.0.0.100' && D(fs).svc.dhcp.max === 21 && D(fs).svc.dhcp.gw === '10.0.0.1', 'nach Autorisierung: Pool aktiv');
const cl = A('PC', 'PC-2'); lk(cl, 4); D(cl).cfg.dhcp = true; ok(!!api.dhcpRequest(D(cl)).ip, 'Client bekommt eine Adresse per DHCP');

// IIS + Firewall
W('FS01', 'Install-WindowsFeature Web-Server'); ok(D(fs).svc.http.on && api.httpGet(D(pc), 'http://10.0.0.30').ok, 'IIS installiert: Seite erreichbar');
W('FS01', 'Set-Content -Path C:\\inetpub\\wwwroot\\index.html -Value "<html><head><title>Intranet</title></head><body>Hallo Windows</body></html>"');
ok(/Hallo Windows/.test(api.httpGet(D(pc), 'http://10.0.0.30').body), 'index.html wird ausgeliefert');
W('FS01', 'Disable-NetFirewallRule -DisplayName "World Wide Web Services (HTTP Traffic-In)"'); ok(!api.httpGet(D(pc), 'http://10.0.0.30').ok, 'Firewall-Regel aus: blockiert');
W('FS01', 'Enable-NetFirewallRule -DisplayName "World Wide Web Services (HTTP Traffic-In)"'); ok(api.httpGet(D(pc), 'http://10.0.0.30').ok, 'Firewall-Regel an: erreichbar');
W('FS01', 'Stop-Service W3SVC'); ok(!D(fs).svc.http.on && /Stopped/.test(W('FS01', 'Get-Service W3SVC')), 'Stop-Service W3SVC'); W('FS01', 'Start-Service W3SVC'); ok(D(fs).svc.http.on, 'Start-Service');

// Dateifreigabe
W('FS01', 'Install-WindowsFeature FS-FileServer'); W('FS01', 'New-Item -ItemType Directory -Path D:\\Daten');
ok(/Keine Zuordnung/.test(W('FS01', 'New-SmbShare -Name Daten -Path D:\\Daten -FullAccess LAB\\Gibtsnicht')), 'Freigabe: unbekannte Gruppe');
ok(/Daten/.test(W('FS01', 'New-SmbShare -Name Daten -Path D:\\Daten -FullAccess LAB\\Vertrieb')) && /Daten/.test(W('FS01', 'Get-SmbShare')), 'Freigabe mit Gruppe');

// DNS-Server (ohne AD)
const ns = A('Server', 'NS01'); net.devs[ns].os = 'windows'; lk(ns, 5); W('NS01', 'New-NetIPAddress -InterfaceAlias Ethernet0 -IPAddress 10.0.0.40 -PrefixLength 24');
W('NS01', 'Install-WindowsFeature DNS'); W('NS01', 'Add-DnsServerPrimaryZone -Name test.local'); W('NS01', 'Add-DnsServerResourceRecordA -Name www -ZoneName test.local -IPv4Address 10.0.0.50');
D(pc).win.domain = null; D(pc).cfg.dns = '10.0.0.40'; ok(api.resolve(D(pc), 'www.test.local').ip === '10.0.0.50', 'Windows-DNS-Server loest www.test.local auf');
process.exit(bad ? 1 : 0);
