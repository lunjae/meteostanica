#include <stdint.h>
#define MQTT_PORT     41883
const char* MQTT_USER = "esp32";          // koristi se samo ako je u mosquitto.conf ukljucena lozinka
const char* MQTT_PASS = "9e473ccf946974d9e31d94d5b876db46";
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