import {
  ActionPanel,
  Action,
  List,
  Icon,
  showToast,
  Toast,
  Form,
  Detail,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import {
  getDevices,
  execAdb,
  connectWirelessDevice,
  enableTcpIpDebugging,
  getPairingServices,
  pairWirelessDevice,
  restartAdbServer,
} from "./utils/adb";
import { randomInt } from "crypto";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { openTerminalWithCommand } from "./utils/terminal";
import { getErrorMessage } from "./utils/errors";

export default function Command() {
  const {
    isLoading,
    data: devices,
    error,
    revalidate,
  } = usePromise(getDevices, []);

  if (error) {
    showToast({
      style: Toast.Style.Failure,
      title: "Failed to get devices",
      message: error.message,
    });
  }

  async function handleRestartServer() {
    const toast = await showToast({
      title: "Restarting ADB server...",
      style: Toast.Style.Animated,
    });

    try {
      await restartAdbServer();
      toast.style = Toast.Style.Success;
      toast.title = "ADB Server Restarted";
      revalidate();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to Restart ADB";
      toast.message = getErrorMessage(error);
    }
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search devices...">
      <List.EmptyView
        title="No devices found"
        description="Pair or connect a wireless device, or plug in a device over USB"
      />
      <List.Section title="Wireless Debugging">
        <List.Item
          title="Pair with QR Code"
          subtitle="Scan from Android Wireless debugging"
          icon={Icon.BarCode}
          accessories={[{ text: "Easier" }]}
          actions={
            <WirelessActions
              onReload={revalidate}
              onRestartServer={handleRestartServer}
            />
          }
        />
        <List.Item
          title="Connect to Paired Device"
          subtitle="Use the Wireless debugging IP address and port"
          icon={Icon.Network}
          actions={
            <WirelessActions
              onReload={revalidate}
              onRestartServer={handleRestartServer}
            />
          }
        />
      </List.Section>
      <List.Section title="Connected Devices">
        {devices?.map((device) => (
          <List.Item
            key={device.id}
            icon={Icon.Mobile}
            title={device.model}
            subtitle={device.id}
            accessories={[{ text: device.state }]}
            actions={
              <ActionPanel>
                <Action
                  title="Reload Devices"
                  icon={Icon.ArrowClockwise}
                  onAction={revalidate}
                />
                <Action.Push
                  title="Pair with Qr Code"
                  icon={Icon.BarCode}
                  target={<QrPairWirelessDevice onPaired={revalidate} />}
                />
                <Action.Push
                  title="Connect to Paired Device"
                  icon={Icon.Network}
                  target={<ConnectDevice />}
                />
                <Action
                  title="Enable Wireless Debugging"
                  icon={Icon.Wifi}
                  onAction={() => handleEnableTcpIp(device.id)}
                />
                <Action
                  title="Reboot Device"
                  icon={Icon.Power}
                  onAction={() => execAdb("reboot", device.id).then(revalidate)}
                />
                <Action
                  title="Open Shell in Terminal"
                  icon={Icon.Terminal}
                  onAction={() =>
                    openTerminalWithCommand(`adb -s ${device.id} shell`)
                  }
                />
                <Action
                  title="Restart Adb Server"
                  icon={Icon.ArrowClockwise}
                  onAction={handleRestartServer}
                />
              </ActionPanel>
            }
          />
        ))}
        {devices?.length === 0 && (
          <List.Item
            title="No Connected Devices"
            subtitle="Use wireless pairing above or connect via USB"
            icon={Icon.Mobile}
            actions={
              <WirelessActions
                onReload={revalidate}
                onRestartServer={handleRestartServer}
              />
            }
          />
        )}
      </List.Section>
    </List>
  );
}

function WirelessActions({
  onReload,
  onRestartServer,
}: {
  onReload: () => void;
  onRestartServer: () => void;
}) {
  return (
    <ActionPanel>
      <Action.Push
        title="Pair with Qr Code"
        icon={Icon.BarCode}
        target={<QrPairWirelessDevice onPaired={onReload} />}
      />
      <Action.Push
        title="Pair with Pairing Code"
        icon={Icon.Wifi}
        target={<PairWirelessDevice />}
      />
      <Action.Push
        title="Connect to Paired Device"
        icon={Icon.Network}
        target={<ConnectDevice />}
      />
      <Action
        title="Reload Devices"
        icon={Icon.ArrowClockwise}
        onAction={onReload}
      />
      <Action
        title="Restart Adb Server"
        icon={Icon.ArrowClockwise}
        onAction={onRestartServer}
      />
    </ActionPanel>
  );
}

type QrPairingDetails = {
  serviceName: string;
  password: string;
  pairingString: string;
};

function QrPairWirelessDevice({ onPaired }: { onPaired: () => void }) {
  const [pairingDetails] = useState(createQrPairingDetails);
  const [qrDataUrl, setQrDataUrl] = useState<string>();
  const [status, setStatus] = useState("Generating QR code...");
  const [pairedAddress, setPairedAddress] = useState<string>();
  const [isPaired, setIsPaired] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let isMounted = true;

    QRCode.toDataURL(pairingDetails.pairingString, {
      margin: 1,
      width: 260,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    })
      .then((dataUrl) => {
        if (isMounted) {
          setQrDataUrl(dataUrl);
          setStatus("Waiting for phone to scan QR code...");
        }
      })
      .catch((qrError) => {
        if (isMounted) {
          setError(getErrorMessage(qrError));
          setStatus("Failed to generate QR code");
        }
      });

    return () => {
      isMounted = false;
    };
  }, [pairingDetails.pairingString]);

  useEffect(() => {
    let isStopped = false;
    let timeout: NodeJS.Timeout | undefined;

    async function pollForScannedQr() {
      if (isStopped || isPaired) {
        return;
      }

      try {
        const services = await getPairingServices();
        const matchingService = services.find(
          (service) => service.serviceName === pairingDetails.serviceName,
        );

        if (!matchingService) {
          setStatus("Waiting for phone to scan QR code...");
          timeout = setTimeout(pollForScannedQr, 1500);
          return;
        }

        setStatus("Phone found. Pairing...");
        const pairOutput = await pairWirelessDevice(
          matchingService.address,
          pairingDetails.password,
        );
        const address = getPairedAddress(pairOutput);
        setPairedAddress(address);

        if (address) {
          setStatus("Paired. Connecting...");
          const connectOutput = await connectWirelessDevice(address);
          setStatus(
            isSuccessfulConnect(connectOutput)
              ? "Paired and connected"
              : "Paired. Use Connect to Paired Device if it does not appear.",
          );
        } else {
          setStatus("Paired. Waiting for ADB to list the device...");
        }

        setIsPaired(true);
        onPaired();
        showToast(Toast.Style.Success, "Wireless Device Paired");
      } catch (pollError) {
        const message = getErrorMessage(pollError);
        setError(message);
        setStatus("Pairing failed");
        showToast(Toast.Style.Failure, "Failed to Pair", message);
      }
    }

    pollForScannedQr();

    return () => {
      isStopped = true;
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [isPaired, onPaired, pairingDetails.password, pairingDetails.serviceName]);

  const markdown = [
    qrDataUrl
      ? `![Wireless ADB QR Code](${qrDataUrl})`
      : "Generating QR code...",
    "",
    `\n**Status:** ${status}\n`,
    "",
    "Android: Developer Options > Wireless debugging > Pair device with QR code.",
    "",
    pairedAddress ? `Connected address: \`${pairedAddress}\`` : "",
    error ? `Error: \`${error}\`` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <Detail
      isLoading={!qrDataUrl && !error}
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action.CopyToClipboard
            title="Copy Qr Payload"
            content={pairingDetails.pairingString}
          />
          <Action.Push
            title="Pair with Pairing Code"
            icon={Icon.Wifi}
            target={<PairWirelessDevice />}
          />
        </ActionPanel>
      }
    />
  );
}

async function handleEnableTcpIp(deviceId: string) {
  const toast = await showToast({
    title: "Enabling TCP/IP debugging...",
    style: Toast.Style.Animated,
  });

  try {
    const output = await enableTcpIpDebugging(deviceId);
    toast.style = Toast.Style.Success;
    toast.title = "TCP/IP Debugging Enabled";
    toast.message =
      output.trim() || "Connect to this device with its Wi-Fi IP on port 5555";
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title = "Failed to Enable TCP/IP";
    toast.message = getErrorMessage(error);
  }
}

function PairWirelessDevice() {
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(values: {
    pairingAddress: string;
    pairingCode: string;
    deviceAddress: string;
  }) {
    const pairingAddress = normalizeAddress(values.pairingAddress);
    const pairingCode = values.pairingCode.trim();
    const deviceAddress = normalizeAddress(values.deviceAddress);

    if (!pairingAddress) {
      showToast(Toast.Style.Failure, "Please enter the pairing address");
      return;
    }

    if (!isHostPort(pairingAddress)) {
      showToast(
        Toast.Style.Failure,
        "Pairing address must include IP and port",
        "Example: 192.168.1.10:37123",
      );
      return;
    }

    if (!isPairingCode(pairingCode)) {
      showToast(
        Toast.Style.Failure,
        "Pairing code must be six digits",
        "Example: 123456",
      );
      return;
    }

    if (deviceAddress && !isHostPort(deviceAddress)) {
      showToast(
        Toast.Style.Failure,
        "Device address must include IP and port",
        "Example: 192.168.1.10:45678",
      );
      return;
    }

    setIsLoading(true);
    const toast = await showToast({
      title: "Pairing device...",
      style: Toast.Style.Animated,
    });

    try {
      const pairOutput = await pairWirelessDevice(pairingAddress, pairingCode);
      const normalizedPairOutput = pairOutput.toLowerCase();

      if (
        normalizedPairOutput.includes("successfully paired") ||
        normalizedPairOutput.includes("paired to")
      ) {
        toast.style = Toast.Style.Success;
        toast.title = "Device Paired";
        toast.message = pairOutput.trim();
      } else {
        toast.style = Toast.Style.Failure;
        toast.title = "Pairing Response";
        toast.message = pairOutput.trim();
        return;
      }

      if (deviceAddress) {
        const connectOutput = await connectWirelessDevice(deviceAddress);
        toast.title = isSuccessfulConnect(connectOutput)
          ? "Paired and Connected"
          : "Paired, Connect Failed";
        toast.style = isSuccessfulConnect(connectOutput)
          ? Toast.Style.Success
          : Toast.Style.Failure;
        toast.message = connectOutput.trim();
      }
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to Pair";
      toast.message = getErrorMessage(error);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Pair Wireless Device"
            icon={Icon.Wifi}
            onSubmit={handleSubmit}
          />
        </ActionPanel>
      }
    >
      <Form.Description text="On your phone, open Developer Options > Wireless debugging > Pair device with pairing code. Your Mac and phone must be on the same Wi-Fi." />
      <Form.TextField
        id="pairingAddress"
        title="Pairing Address"
        placeholder="192.168.1.10:37123"
      />
      <Form.PasswordField
        id="pairingCode"
        title="Pairing Code"
        placeholder="123456"
      />
      <Form.Separator />
      <Form.TextField
        id="deviceAddress"
        title="Device Address (Optional)"
        placeholder="192.168.1.10:45678"
      />
      <Form.Description text="After pairing, Android shows a separate IP address and port on the Wireless debugging screen. Add it here to connect immediately, or use Connect to Paired Device later." />
    </Form>
  );
}

function ConnectDevice() {
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(values: { ip: string }) {
    const deviceAddress = normalizeAddress(values.ip);

    if (!deviceAddress) {
      showToast(Toast.Style.Failure, "Please enter a device address");
      return;
    }

    if (!isHostPort(deviceAddress)) {
      showToast(
        Toast.Style.Failure,
        "Device address must include IP and port",
        "Example: 192.168.1.10:5555",
      );
      return;
    }

    setIsLoading(true);
    const toast = await showToast({
      title: "Connecting...",
      style: Toast.Style.Animated,
    });
    try {
      const output = await connectWirelessDevice(deviceAddress);
      if (isSuccessfulConnect(output)) {
        toast.style = Toast.Style.Success;
        toast.title = "Connected Successfully";
        toast.message = output.trim();
      } else {
        toast.style = Toast.Style.Failure;
        toast.title = "Failed to Connect";
        toast.message = output.trim();
      }
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to Connect";
      toast.message = getErrorMessage(error);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Connect"
            icon={Icon.Network}
            onSubmit={handleSubmit}
          />
        </ActionPanel>
      }
    >
      <Form.Description text="Use the IP address and port shown on the Android Wireless debugging screen. For the older USB tcpip flow, use the phone's Wi-Fi IP with port 5555." />
      <Form.TextField
        id="ip"
        title="Device Address"
        placeholder="e.g. 192.168.1.10:5555"
      />
    </Form>
  );
}

function normalizeAddress(value?: string) {
  return value?.trim().replace(/^adb\s+(pair|connect)\s+/i, "") ?? "";
}

function isHostPort(value: string) {
  const match = value.match(/^([a-zA-Z0-9.-]+|\[[0-9a-fA-F:]+\]):(\d{1,5})$/);
  if (!match) {
    return false;
  }

  const port = Number(match[2]);
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

function isPairingCode(value: string) {
  return /^\d{6}$/.test(value);
}

function isSuccessfulConnect(output: string) {
  const normalizedOutput = output.toLowerCase();
  return (
    normalizedOutput.includes("connected to") ||
    normalizedOutput.includes("already connected to")
  );
}

function createQrPairingDetails(): QrPairingDetails {
  const serviceName = `studio-${createRandomString(
    10,
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-",
  )}`;
  const password = createRandomString(
    12,
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-+*/<>{}",
  );

  return {
    serviceName,
    password,
    pairingString: `WIFI:T:ADB;S:${serviceName};P:${password};;`,
  };
}

function createRandomString(length: number, characters: string) {
  let result = "";
  for (let index = 0; index < length; index++) {
    result += characters[randomInt(characters.length)];
  }
  return result;
}

function getPairedAddress(output: string) {
  return output.match(/Successfully paired to ([^\s]+)\s/)?.[1];
}
