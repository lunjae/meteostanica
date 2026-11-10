/*
  ETH01-EVO (ESP32-C3 + DM9051) meteostanica
    - SCD41 (CO2, temp, vlaga)  + LCD 16x2 (I2C) na istoj magistrali
    - senzor nivoa vode (ADC)
    - Ethernet + MQTT (bez TLS-a) na lokalni Mosquitto broker

  Potrebno: Arduino-ESP32 core 3.x, biblioteka PubSubClient,
            SparkFun SCD4x, hd44780 (iste kao do sada).

  Pinovi DM9051 (zauzeti, ne koristiti): IO3, IO6, IO7, IO8, IO9, IO10
  Tvoji pinovi (slobodni): IO0 (ADC vode), IO1 (SDA), IO2 (SCL), IO18 (napajanje senzora vode)

  Komanda na topic meteo/<ID>/cmd:  INTERVAL:60  (interval slanja u sekundama, 5..3600)
*/

#include <Wire.h>
#include <SPI.h>
#include <ETH.h>
#include <NetworkClient.h>
#include <PubSubClient.h>
#include "SparkFun_SCD4x_Arduino_Library.h"
#include <hd44780.h>
#include <hd44780ioClass/hd44780_I2Cexp.h>

// ================== PODESAVANJA ==================
const char* MQTT_HOST = "bore.pub";   // IP Windows racunara na kome radi Mosquitto (ipconfig)
#define MQTT_PORT     41883
const char* MQTT_USER = "esp32";          // koristi se samo ako je u mosquitto.conf ukljucena lozinka
const char* MQTT_PASS = "123456";
#define SENSOR_ID     1

uint32_t intervalSlanjaS = 60;           // koliko cesto se salje na MQTT

// Zajednicki I2C za SCD41 i LCD
#define I2C_SDA 1
#define I2C_SCL 2

#define WATER_POWER_PIN  18
#define WATER_SIGNAL_PIN 0

// DM9051 (fiksno na ploci)
#define ETH_PHY_ADDR_EVO 1
#define ETH_CS_PIN       9
#define ETH_INT_PIN      8
#define ETH_RST_PIN      6
#define ETH_SCK_PIN      7
#define ETH_MISO_PIN     3
#define ETH_MOSI_PIN     10
// =================================================

// LCD
hd44780_I2Cexp lcd;

// Kalibracija senzora vode
const int ADC_SUV = 0;
const int ADC_PUN = 1800;
const float DUBINA_MAX = 40.0;
const int BROJ_UZORAKA = 10;

SCD4x co2Sensor;

unsigned long zadnjeMerenjeVode = 0;
const unsigned long intervalVode = 5000;

NetworkClient netClient;
PubSubClient mqtt(netClient);

bool ethBegun = false;
bool imaMerenje = false;                 // true kad stigne prvo merenje sa SCD41
bool poslatoBarJednom = false;
unsigned long zadnjeSlanje = 0;
unsigned long zadnjiPokusajMqtt = 0;

char topicPub[32], topicCmd[32];

// ---------- Senzor vode ----------
int citajVodu() {
  digitalWrite(WATER_POWER_PIN, HIGH);
  delay(20);

  long suma = 0;
  for (int i = 0; i < BROJ_UZORAKA; i++) {
    suma += analogRead(WATER_SIGNAL_PIN);
    delay(2);
  }

  digitalWrite(WATER_POWER_PIN, LOW);
  return suma / BROJ_UZORAKA;
}

float adcUDubinu(int adc) {
  float dubina = (float)(adc - ADC_SUV) * DUBINA_MAX / (ADC_PUN - ADC_SUV);
  dubina -= 10.0;
  return constrain(dubina, 0.0, DUBINA_MAX);
}

// ---------- Ethernet / MQTT ----------
bool ethHasIp() {
  return ethBegun && ETH.localIP() != IPAddress(0, 0, 0, 0);
}

void onMqtt(char* topic, byte* payload, unsigned int length) {
  String msg;
  for (unsigned int i = 0; i < length && i < 32; i++) msg += (char)payload[i];
  msg.trim();
  msg.toUpperCase();
  Serial.printf("[MQTT] %s: %s\n", topic, msg.c_str());

  if (msg.startsWith("INTERVAL:")) {
    int v = msg.substring(9).toInt();
    if (v >= 5 && v <= 3600) {
      intervalSlanjaS = v;
      Serial.printf("Interval slanja = %d s\n", v);
    }
  }
}

void mqttEnsure() {
  if (mqtt.connected() || !ethHasIp()) return;
  if (zadnjiPokusajMqtt != 0 && millis() - zadnjiPokusajMqtt < 10000) return;
  zadnjiPokusajMqtt = millis();

  char cid[24];
  snprintf(cid, sizeof(cid), "meteo-%d", SENSOR_ID);
Serial.printf("ESP IP: %s, maska: %s, gateway: %s -> broker %s:%d\n",
              ETH.localIP().toString().c_str(), ETH.subnetMask().toString().c_str(),
              ETH.gatewayIP().toString().c_str(), MQTT_HOST, MQTT_PORT);
  Serial.print(F("[MQTT] povezivanje... "));
  if (mqtt.connect(cid, MQTT_USER, MQTT_PASS)) {
    Serial.println(F("OK"));
    mqtt.subscribe(topicCmd);
  } else {
    Serial.printf("greska rc=%d\n", mqtt.state());
  }
}

void mqttPublish(int co2, float temperatura, float vlaznost, float dubina) {
  char json[160];
  snprintf(json, sizeof(json),
           "{\"sensor_id\":%d,\"co2\":%d,\"temp\":%.1f,\"hum\":%.1f,\"voda_mm\":%.1f}",
           SENSOR_ID, co2, temperatura, vlaznost, dubina);
  bool ok = mqtt.publish(topicPub, json, true);   // retained: poslednja vrednost ostaje na brokeru
  Serial.printf("[MQTT] %s -> %s %s\n", topicPub, json, ok ? "OK" : "GRESKA");
}

// ---------- LCD ----------
void prikaziLCD(int co2, float temperatura, float vlaznost, float dubina) {
  lcd.setCursor(0, 0);
  lcd.printf("CO2:%4d T:%4.1f", co2, temperatura);
  lcd.setCursor(15, 0);
  lcd.print(mqtt.connected() ? 'M' : '-');      // M = povezan na MQTT

  lcd.setCursor(0, 1);
  lcd.printf("H:%4.1f%% D:%2.0fmm", vlaznost, dubina);
  lcd.setCursor(15, 1);
  lcd.print(ethHasIp() ? 'E' : '-');            // E = Ethernet ima IP
}

void setup() {
  Serial.begin(115200);
  delay(2000);

  Serial.println(F("\n--- Pokretanje Sistema ---"));

  snprintf(topicPub, sizeof(topicPub), "meteo/%d/reading", SENSOR_ID);
  snprintf(topicCmd, sizeof(topicCmd), "meteo/%d/cmd", SENSOR_ID);

  // Senzor vode
  pinMode(WATER_POWER_PIN, OUTPUT);
  analogSetPinAttenuation(WATER_SIGNAL_PIN, ADC_11db);
  digitalWrite(WATER_POWER_PIN, LOW);

  // Zajednicki hardverski I2C
  Wire.begin(I2C_SDA, I2C_SCL);

  // LCD
  int status = lcd.begin(16, 2);
  if (status) {
    Serial.println("Greska pri pokretanju LCD-a!");
    while (1);
  }
  lcd.backlight();
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Meteo stanica");
  lcd.setCursor(0, 1);
  lcd.print("Pokretanje...");

  // SCD41
  co2Sensor.enableDebugging();
  if (co2Sensor.begin() == false) {
    Serial.println(F("GRESKA: SCD41 nije detektovan!"));
    lcd.clear();
    lcd.print("SCD41 greska!");
    while (1);
  }
  Serial.println(F("SCD41 uspesno pokrenut."));

  // Ethernet (ne ceka IP; loop() ceka u pozadini)
  SPI.begin(ETH_SCK_PIN, ETH_MISO_PIN, ETH_MOSI_PIN);
  ethBegun = ETH.begin(ETH_PHY_DM9051, ETH_PHY_ADDR_EVO, ETH_CS_PIN, ETH_INT_PIN, ETH_RST_PIN, SPI, 8);
  Serial.println(ethBegun ? F("Ethernet: pokrenut, cekam IP...") : F("GRESKA: Ethernet (DM9051) nije pokrenut"));

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(512);
  mqtt.setKeepAlive(30);
  mqtt.setCallback(onMqtt);

  delay(1500);
  lcd.clear();
}

void loop() {
  static int co2 = 0;
  static float temperatura = 0.0;
  static float vlaznost = 0.0;
  static float dubinaMM = 0.0;

  // Citanje SCD41
  if (co2Sensor.readMeasurement()) {
    co2 = co2Sensor.getCO2();
    temperatura = co2Sensor.getTemperature();
    vlaznost = co2Sensor.getHumidity();
    imaMerenje = true;

    Serial.print(F("CO2(ppm): "));
    Serial.print(co2);
    Serial.print(F("\tTemperature(C): "));
    Serial.print(temperatura, 1);
    Serial.print(F("\tHumidity(%RH): "));
    Serial.println(vlaznost, 1);
  }

  // Citanje senzora vode
  if (millis() - zadnjeMerenjeVode >= intervalVode) {
    zadnjeMerenjeVode = millis();

    int nivoVode = citajVodu();
    dubinaMM = adcUDubinu(nivoVode);

    Serial.print(F("Voda ADC: "));
    Serial.print(nivoVode);
    Serial.print(F("\tDubina(mm): "));
    Serial.println(dubinaMM, 1);
  }

  // MQTT: odrzavaj vezu i salji merenja
  mqttEnsure();
  if (mqtt.connected()) {
    mqtt.loop();
    if (imaMerenje && (!poslatoBarJednom || millis() - zadnjeSlanje >= intervalSlanjaS * 1000UL)) {
      zadnjeSlanje = millis();
      poslatoBarJednom = true;
      mqttPublish(co2, temperatura, vlaznost, dubinaMM);
    }
  }

  // LCD
  prikaziLCD(co2, temperatura, vlaznost, dubinaMM);

  delay(100);
}
