-- Umstellung auf kurze Sitzungen: alle bisherigen, bis zu 30 Tage gültigen Anmeldungen beenden.
-- Danach muss sich jeder (auch Admins) einmal neu per E-Mail-Link anmelden.
DELETE FROM `auth_sessions`;
