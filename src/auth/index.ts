import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { admin } from "better-auth/plugins";
import { envVars } from "../config";
import { sharedMongoClient } from "../data/db/client";
import { UserProfile } from "../data/db/models/user_profile";

const mongoDb = sharedMongoClient.db();
const socialProviders: Record<string, object> = {};

if (envVars.GOOGLE_CLIENT_ID && envVars.GOOGLE_CLIENT_SECRET) {
  socialProviders["google"] = {
    clientId: envVars.GOOGLE_CLIENT_ID,
    clientSecret: envVars.GOOGLE_CLIENT_SECRET,
  };
}

if (envVars.GITHUB_CLIENT_ID && envVars.GITHUB_CLIENT_SECRET) {
  socialProviders["github"] = {
    clientId: envVars.GITHUB_CLIENT_ID,
    clientSecret: envVars.GITHUB_CLIENT_SECRET,
  };
}

export const auth = betterAuth({
  baseURL: envVars.BETTER_AUTH_URL,
  secret: envVars.BETTER_AUTH_SECRET,
  trustedOrigins: [envVars.CLIENT_URL],
  database: mongodbAdapter(mongoDb, {
    client: sharedMongoClient,
  }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders,
  user: {
    additionalFields: {
      role: {
        type: "string",
        input: false,
      },
    },
  },
  plugins: [
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
    }),
  ],
});

async function createProfileForUser(userId: string, displayName: string) {
  try {
    await UserProfile.create({ userId, displayName });
  } catch (err) {
    console.error("Failed to auto-create profile:", err);
  }
}

export const seedAdminUser = async (
  email: string,
  password: string,
  name: string,
) => {
  const db = sharedMongoClient.db();
  const usersCollection = db.collection("user");

  const existing = await usersCollection.findOne({ email });
  if (existing) {
    await usersCollection.updateOne({ email }, { $set: { role: "admin" } });
    return;
  }

  const result = await auth.api.signUpEmail({
    body: { email, password, name },
  });

  if (result?.user) {
    await usersCollection.updateOne({ email }, { $set: { role: "admin" } });
    await createProfileForUser(result.user.id, name);
  }
};

export { createProfileForUser };
