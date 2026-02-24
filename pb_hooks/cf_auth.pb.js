// cf_auth.pb.js
// Decodes the Cloudflare Access JWT, extracts the user's email, then
// finds-or-creates a PocketBase user record and returns a PB auth token.
// No static user accounts needed — whoever CF says you are, you get a PB session.

routerAdd("POST", "/api/cf-auth", (c) => {
    function decodeBase64url(s) {
        s = s.replace(/-/g, "+").replace(/_/g, "/");
        var pad = s.length % 4;
        if (pad === 2) s += "==";
        else if (pad === 3) s += "=";
        var b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
        var out = "", i = 0;
        s = s.replace(/[^A-Za-z0-9+/=]/g, "");
        while (i < s.length) {
            var e1 = b64.indexOf(s.charAt(i++));
            var e2 = b64.indexOf(s.charAt(i++));
            var e3 = b64.indexOf(s.charAt(i++));
            var e4 = b64.indexOf(s.charAt(i++));
            out += String.fromCharCode((e1 << 2) | (e2 >> 4));
            if (e3 !== 64) out += String.fromCharCode(((e2 & 15) << 4) | (e3 >> 2));
            if (e4 !== 64) out += String.fromCharCode(((e3 & 3) << 6) | e4);
        }
        return out;
    }

    const jwt = c.request().header.get("Cf-Access-Jwt-Assertion");

    if (!jwt || jwt.split(".").length !== 3) {
        return c.json(401, { error: "missing or malformed CF Access JWT" });
    }

    // Decode the JWT payload (middle part, base64url encoded).
    // CF Access has already validated the JWT signature at the edge.
    let email;
    try {
        const payload = JSON.parse(decodeBase64url(jwt.split(".")[1]));
        email = payload.email;
    } catch (e) {
        return c.json(401, { error: "failed to decode CF JWT: " + String(e) });
    }

    if (!email) {
        return c.json(401, { error: "no email claim in CF JWT" });
    }

    // Find or create the PocketBase user for this CF identity.
    let record;
    try {
        record = $app.dao().findAuthRecordByEmail("users", email);
    } catch (_) {
        // User doesn't exist yet — create them.
        const collection = $app.dao().findCollectionByNameOrId("users");
        record = new Record(collection);
        record.set("username", email.split("@")[0] + "_" + $security.randomString(6));
        record.set("email", email);
        record.set("emailVisibility", true);
        // Random password — login is always via CF, never by password.
        record.setPassword($security.randomString(40));
        $app.dao().saveRecord(record);
    }

    const token = $tokens.recordAuthToken($app, record);

    return c.json(200, {
        token,
        record: record.publicExport(),
    });
});
