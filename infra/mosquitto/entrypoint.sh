#!/bin/sh
# Gera o arquivo de senhas de desenvolvimento a partir das variáveis de ambiente e sobe o broker.
set -eu
: "${MQTT_DEV_USERNAME:?MQTT_DEV_USERNAME não definido}"
: "${MQTT_DEV_PASSWORD:?MQTT_DEV_PASSWORD não definido}"

passwd_file=/mosquitto/data/passwd
rm -f "$passwd_file"
mosquitto_passwd -c -b "$passwd_file" "$MQTT_DEV_USERNAME" "$MQTT_DEV_PASSWORD"
chown mosquitto:mosquitto "$passwd_file"
chmod 0600 "$passwd_file"

exec mosquitto -c /mosquitto/config/mosquitto.conf
