// cf_auth.pb.js
// Receives X-Auth-Email from nginx (CF JWT already validated by cf-auth sidecar).
// Finds or creates the PB user and returns a PB auth token.

routerAdd("POST", "/api/cf-auth", (c) => {
    const email = c.request().header.get("X-Auth-Email");
    if (!email) {
        return c.json(401, { error: "missing X-Auth-Email — is the cf-auth sidecar running?" });
    }

    let record;
    try {
        record = $app.dao().findAuthRecordByEmail("users", email);
    } catch (_) {
        const collection = $app.dao().findCollectionByNameOrId("users");
        record = new Record(collection);
        record.set("username", email.split("@")[0] + "_" + $security.randomString(6));
        record.set("email", email);
        record.set("emailVisibility", true);
        record.setPassword($security.randomString(40));
        $app.dao().saveRecord(record);
    }

    const token = $tokens.recordAuthToken($app, record);
    return c.json(200, { token, record: record.publicExport() });
});
