import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import WifiSerialProvisioner from "./WifiSerialProvisioner";
import {
  connectDeviceToUser,
  createDevice,
  listKnownWifiNetworks,
  listDevices,
  saveDeviceWifiConfiguration
} from "../lib/devices";
import {
  authenticateUser,
  createSession,
  createUser,
  deleteSession,
  getUserBySessionToken
} from "../lib/auth";

function normalizeField(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildRedirect(pathname, params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      query.set(key, value);
    }
  });

  const queryString = query.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

async function getCurrentUser() {
  const sessionToken = cookies().get("session_token")?.value;
  return getUserBySessionToken(sessionToken);
}

function getSessionCookieOptions(expiresAt) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.ENABLE_SECURE_COOKIES === "true",
    expires: expiresAt,
    path: "/"
  };
}

async function requireUser() {
  const user = await getCurrentUser();

  if (!user) {
    redirect(buildRedirect("/", { authError: "Please login to connect your Arduino device." }));
  }

  return user;
}

async function registerUser(formData) {
  "use server";

  const fullName = normalizeField(formData.get("fullName"));
  const email = normalizeField(formData.get("email"));
  const password = normalizeField(formData.get("password"));

  if (!fullName || !email || password.length < 6) {
    redirect(
      buildRedirect("/", {
        authError: "Enter your name, email, and a password with at least 6 characters.",
        authView: "register"
      })
    );
  }

  try {
    const user = await createUser({
      fullName,
      email,
      password
    });
    const session = await createSession(user.id);

    cookies().set("session_token", session.sessionToken, getSessionCookieOptions(session.expiresAt));
  } catch (error) {
    redirect(
      buildRedirect("/", {
        authError: "Unable to register. That email may already be in use.",
        authView: "register"
      })
    );
  }

  redirect(
    buildRedirect("/", {
      authMessage: "Account created. Connect your Arduino and save Wi-Fi now."
    })
  );
}

async function loginUser(formData) {
  "use server";

  const email = normalizeField(formData.get("email"));
  const password = normalizeField(formData.get("password"));
  const user = await authenticateUser({ email, password });

  if (!user) {
    redirect(buildRedirect("/", { authError: "Invalid email or password." }));
  }

  const session = await createSession(user.id);

  cookies().set("session_token", session.sessionToken, getSessionCookieOptions(session.expiresAt));

  redirect(
    buildRedirect("/", {
      authMessage: "Logged in. Connect your Arduino device below."
    })
  );
}

async function logoutUser() {
  "use server";

  const sessionToken = cookies().get("session_token")?.value;

  await deleteSession(sessionToken);
  cookies().delete("session_token");

  redirect(buildRedirect("/", { authMessage: "Logged out." }));
}

async function registerDevice(formData) {
  "use server";

  const user = await requireUser();

  const deviceId = normalizeField(formData.get("deviceId"));
  const deviceName = normalizeField(formData.get("deviceName"));
  const deviceType = normalizeField(formData.get("deviceType")) || "arduino";
  const location = normalizeField(formData.get("location"));

  if (!deviceId || !deviceName) {
    throw new Error("deviceId and deviceName are required");
  }

  try {
    await createDevice({
      deviceId,
      deviceName,
      deviceType,
      location,
      ownerUserId: user.id
    });
  } catch (error) {
    redirect(
      buildRedirect("/", {
        authError: "Unable to register that device. The device ID may already exist."
      })
    );
  }

  revalidatePath("/");
  redirect(
    buildRedirect("/", {
      authMessage: `Device ${deviceId} registered. Now save Wi-Fi for it.`,
      selectedDevice: deviceId
    })
  );
}

async function saveWifiForDevice(formData) {
  "use server";

  const user = await requireUser();
  const deviceId = normalizeField(formData.get("deviceId"));
  const selectedWifi = normalizeField(formData.get("selectedWifi"));
  const manualWifi = normalizeField(formData.get("manualWifi"));
  const wifiPassword = normalizeField(formData.get("wifiPassword"));
  const wifiSsid = manualWifi || selectedWifi;

  if (!deviceId || !wifiSsid || !wifiPassword) {
    redirect(
      buildRedirect("/", {
        authError: "Choose a device, enter the Wi-Fi name, and enter the password.",
        selectedDevice: deviceId
      })
    );
  }

  const updatedDevice = await saveDeviceWifiConfiguration({
    deviceId,
    userId: user.id,
    wifiSsid,
    wifiPassword
  });

  if (!updatedDevice) {
    redirect(
      buildRedirect("/", {
        authError: "We could not save Wi-Fi settings for that device.",
        selectedDevice: deviceId
      })
    );
  }

  revalidatePath("/");
  redirect(
    buildRedirect("/", {
      authMessage: `Wi-Fi saved for ${deviceId}. Connection status will update after the device reconnects.`,
      selectedDevice: deviceId
    })
  );
}

async function connectArduinoDevice(formData) {
  "use server";

  const user = await requireUser();
  const deviceId = normalizeField(formData.get("deviceId"));

  if (!deviceId) {
    redirect(buildRedirect("/", { authError: "Enter the Arduino device ID to connect it." }));
  }

  const connectedDevice = await connectDeviceToUser({
    deviceId,
    userId: user.id
  });

  if (!connectedDevice) {
    redirect(
      buildRedirect("/", {
        authError: "That device was not found, or it already belongs to another user."
      })
    );
  }

  revalidatePath("/");
  redirect(
    buildRedirect("/", {
      authMessage: `Arduino device ${deviceId} connected. Now save Wi-Fi for it.`,
      selectedDevice: deviceId
    })
  );
}

export default async function HomePage({ searchParams }) {
  const user = await getCurrentUser();
  const authMessage = searchParams?.authMessage || "";
  const authError = searchParams?.authError || "";
  const authView = searchParams?.authView || "login";
  const selectedDevice = searchParams?.selectedDevice || "";
  const [devices, knownWifiNetworks] = user
    ? await Promise.all([
        listDevices(user.id),
        listKnownWifiNetworks(user.id)
      ])
    : [[], []];

  return (
    <main className="page">
      <div className="shell cloudShell">
        <section className="panel stack">
          {authMessage ? <p className="banner bannerSuccess">{authMessage}</p> : null}
          {authError ? <p className="banner bannerError">{authError}</p> : null}

          {!user ? (
            <div className="authCenter">
              <div className="authStage authStageSolo">
                <div className="authCard authCardFeatured">
                  {authView === "register" ? (
                    <>
                      <p className="authKicker">New User</p>
                      <h2>Create your account</h2>
                      <p className="authCopy">
                        Create an account to start managing your Arduino devices from one dashboard.
                      </p>
                      <form action={registerUser} className="authForm">
                        <input className="input" name="fullName" placeholder="Meenakshi" required />
                        <input className="input" name="email" placeholder="meenakshi@example.com" type="email" required />
                        <input className="input" name="password" placeholder="Choose a password" type="password" required />
                        <button className="button buttonOn" type="submit">
                          Register
                        </button>
                      </form>
                      <p className="authFooterLink">
                        Already have an account? <a href="/?authView=login">Login</a>
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="authKicker">Welcome Back</p>
                      <h2>Login</h2>
                      <p className="authCopy">
                        Sign in to connect your Arduino device.
                      </p>
                      <form action={loginUser} className="authForm">
                        <input className="input" name="email" placeholder="meenakshi@example.com" type="email" required />
                        <input className="input" name="password" placeholder="Your password" type="password" required />
                        <button className="button buttonOff" type="submit">
                          Login
                        </button>
                      </form>
                      <p className="authFooterLink">
                        New user? <a href="/?authView=register">Create an account</a>
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="sectionHeader">
                <div>
                  <p className="authKicker">Arduino Setup</p>
                  <strong>Welcome, {user.full_name}</strong>
                </div>
                <div className="sectionActions">
                  <form action={logoutUser}>
                    <button className="button buttonGhost" type="submit">
                      Logout
                    </button>
                  </form>
                </div>
              </div>

              <div className="authGrid">
                <div className="historyCard">
                  <strong>Connect Arduino Device</strong>
                  <p className="empty">
                    Enter the device ID from your Arduino sketch.
                  </p>
                  <form action={connectArduinoDevice} className="authForm">
                    <input className="input" name="deviceId" placeholder="arduino-led-01" required />
                    <button className="button buttonOff" type="submit">
                      Connect Arduino
                    </button>
                  </form>
                </div>

                <div className="historyCard">
                  <strong>Add New Arduino Device</strong>
                  <p className="empty">
                    Create a new board record, then connect it to Wi-Fi.
                  </p>
                  <form action={registerDevice} className="registerForm">
                    <input className="input" name="deviceId" placeholder="arduino-led-02" required />
                    <input className="input" name="deviceName" placeholder="Greenhouse LED" required />
                    <input className="input" name="deviceType" placeholder="arduino" defaultValue="arduino" />
                    <input className="input" name="location" placeholder="Greenhouse Bay A" />
                    <button className="button buttonOn" type="submit">
                      Add Device
                    </button>
                  </form>
                </div>
              </div>

              <div className="historyCard connectDeviceCard">
                <div>
                  <p className="authKicker">Connect</p>
                  <strong>Save Wi-Fi and Connect</strong>
                </div>
                <p className="empty">
                  Select an Arduino device, scan available Wi-Fi from the board over USB, enter the password, and connect.
                </p>

                {devices.length === 0 ? (
                  <p className="banner bannerError">
                    Add or connect an Arduino device first.
                  </p>
                ) : (
                  <WifiSerialProvisioner
                    devices={devices.map((device) => ({
                      device_id: device.device_id,
                      device_name: device.device_name
                    }))}
                    knownWifiNetworks={knownWifiNetworks}
                    selectedDevice={selectedDevice}
                    saveWifiAction={saveWifiForDevice}
                  />
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
