# Meteo: lokalni MQTT + Go + React (Windows)

```
ESP (ETH01-EVO) --MQTT 1883--> Mosquitto --> Go server (:8080) --> React stranica u pregledacu
```

## 1. Mosquitto (MQTT broker)
1. Instaliraj sa https://mosquitto.org/download/ (Windows installer, ukljuci "Service").
2. Zameni `C:\Program Files\mosquitto\mosquitto.conf` fajlom `mosquitto.conf` iz ovog foldera
   (prvo sacuvaj staru kopiju; potreban je administratorski pristup).
3. Restartuj servis: `services.msc` -> **Mosquitto Broker** -> Restart.
4. Windows Firewall: dozvoli dolazni TCP **1883** (cmd kao Administrator):
   `netsh advfirewall firewall add rule name="Mosquitto 1883" dir=in action=allow protocol=TCP localport=1883`
5. IP racunara saznaj sa `ipconfig` (IPv4 adresa), npr. 192.168.1.20.

Test (drugi cmd prozor):
```
"C:\Program Files\mosquitto\mosquitto_sub" -h localhost -t "meteo/#" -v
"C:\Program Files\mosquitto\mosquitto_pub" -h localhost -t meteo/1/reading -m "{\"co2\":650,\"temp\":22.5,\"hum\":45}"
```

## 2. React aplikacija (jednom izgradi)
Potreban Node.js (https://nodejs.org, LTS).
```
cd web
npm install
npm run build
```

## 3. Go server
Potreban Go (https://go.dev/dl/).
```
cd server
go mod tidy
go run .
```
Otvori **http://localhost:8080**. Server ceka MQTT poruke sa `meteo/<ID>/reading`,
istoriju cuva u `server/readings.jsonl` (ostaje i posle restarta).

Opcije (npr. broker sa lozinkom):
```
go run . -broker tcp://localhost:1883 -user esp32 -pass TVOJA_LOZINKA
```

Tokom razvoja interfejsa: `npm run dev` u `web/` (otvara http://localhost:5173, a Go server radi paralelno).

Za .exe: `go build -o meteo-server.exe` (pokretati iz foldera `server`, da nadje `../web/dist`).

## 4. Izmene u ESP kodu (meteo_eth01evo_lcd.ino)
Za lokalni broker nema TLS-a:
```cpp
const char* MQTT_HOST = "192.168.1.20";   // IP tvog Windows racunara
#define MQTT_PORT     1883
```
- `NetworkClientSecure secureClient;`  ->  `NetworkClient secureClient;`
- obrisi redove `secureClient.setInsecure();` i `secureClient.setTimeout(5);`
- ako si u mosquitto.conf ukljucio lozinku, upisi isti `MQTT_USER` / `MQTT_PASS`;
  ako je `allow_anonymous true`, ostave se bilo koji.

## Rad
- Podaci stizu na `meteo/<ID>/reading` kao JSON (co2, temp, hum, voda_mm, voltage, batt_percent...).
- Interval slanja se menja iz stranice (dno), salje se `INTERVAL:<s>` na `meteo/<ID>/cmd`.
- Dostupno sa telefona u istoj mrezi: `http://<IP racunara>:8080` (otvori TCP 8080 u firewallu).
