import { spawn } from "child_process";
import { createHash } from "crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from "fs";
import { homedir, tmpdir } from "os";
import { basename, extname, join } from "path";
import { execAdbArgs } from "./adb";
import { getErrorMessage } from "./errors";

const iconPromises = new Map<string, Promise<string | undefined>>();

export function getAppIconPath(
  packageName: string,
  userId?: string,
  deviceId?: string,
): Promise<string | undefined> {
  const cacheKey = [
    deviceId ?? "default",
    userId ?? "default",
    packageName,
  ].join(":");
  const existingPromise = iconPromises.get(cacheKey);
  if (existingPromise) {
    return existingPromise;
  }

  const promise = extractAppIcon(packageName, userId, deviceId).catch(
    () => undefined,
  );
  iconPromises.set(cacheKey, promise);
  return promise;
}

async function extractAppIcon(
  packageName: string,
  userId?: string,
  deviceId?: string,
) {
  const aaptPath = getAaptPath();
  if (!aaptPath) {
    return undefined;
  }

  const cacheDir = getIconCacheDir();
  const safeName = getSafeCacheName(
    [deviceId ?? "device", userId ?? "user", packageName].join(":"),
  );
  const cachedPngPath = join(cacheDir, `${safeName}.png`);
  if (existsSync(cachedPngPath)) {
    return cachedPngPath;
  }

  const cachedWebpPath = join(cacheDir, `${safeName}.webp`);
  if (existsSync(cachedWebpPath)) {
    try {
      await convertImageToPng(cachedWebpPath, cachedPngPath);
      return cachedPngPath;
    } catch {
      return undefined;
    }
  }

  const apkPaths = await getApkPaths(packageName, userId, deviceId);
  if (apkPaths.length === 0) {
    return undefined;
  }

  const relevantApkPaths = apkPaths.filter(isIconRelevantApkPath);
  const cachedApkPaths = [];
  for (const apkPath of relevantApkPaths.length > 0
    ? relevantApkPaths
    : apkPaths) {
    const cachedApkPath = join(cacheDir, `${safeName}-${basename(apkPath)}`);
    if (!existsSync(cachedApkPath)) {
      await execAdbArgs(["pull", apkPath, cachedApkPath], { deviceId });
    }
    cachedApkPaths.push(cachedApkPath);
  }

  const cachedBaseApkPath =
    cachedApkPaths.find((cachedApkPath) =>
      basename(cachedApkPath).endsWith("-base.apk"),
    ) ?? cachedApkPaths[0];
  const badgingOutput = await spawnToString(
    aaptPath,
    ["dump", "badging", cachedBaseApkPath],
    { allowStdoutOnError: true },
  );
  const declaredIconPath = getBestIconPathFromBadging(badgingOutput);
  if (!declaredIconPath) {
    return undefined;
  }

  const iconLocation = isRasterIconPath(declaredIconPath)
    ? await findZipEntry(cachedApkPaths, declaredIconPath)
    : await findRasterIconForXmlIcon(cachedApkPaths, declaredIconPath);
  if (!iconLocation) {
    return undefined;
  }

  const extractedIconPath = join(
    cacheDir,
    `${safeName}${extname(iconLocation.entryPath).toLowerCase()}`,
  );
  await extractZipEntry(
    iconLocation.apkPath,
    iconLocation.entryPath,
    extractedIconPath,
  );

  if (!existsSync(extractedIconPath)) {
    return undefined;
  }

  if (extname(extractedIconPath).toLowerCase() === ".webp") {
    try {
      await convertImageToPng(extractedIconPath, cachedPngPath);
      try {
        unlinkSync(extractedIconPath);
      } catch {
        // Best effort cleanup only.
      }
      return existsSync(cachedPngPath) ? cachedPngPath : undefined;
    } catch {
      return undefined;
    }
  }

  return extractedIconPath;
}

async function getApkPaths(
  packageName: string,
  userId?: string,
  deviceId?: string,
) {
  const attempts = userId
    ? [
        ["shell", "pm", "path", "--user", userId, packageName],
        ["shell", "pm", "path", packageName],
      ]
    : [["shell", "pm", "path", packageName]];

  let output = "";
  let lastError: unknown;
  for (const args of attempts) {
    try {
      output = await execAdbArgs(args, { deviceId });
      break;
    } catch (error) {
      lastError = error;
      const message = getErrorMessage(error);
      if (
        !message.includes("SecurityException") &&
        !message.includes("does not have permission to access user")
      ) {
        throw error;
      }
    }
  }

  if (!output) {
    throw lastError ?? new Error(`Failed to resolve APK path for ${packageName}`);
  }

  return output
    .split("\n")
    .map((line) => line.trim().replace(/^package:/, ""))
    .filter((line) => line.endsWith(".apk"))
    .sort((a, b) => getApkPathScore(b) - getApkPathScore(a));
}

function getBestIconPathFromBadging(output: string) {
  const icons = output
    .split("\n")
    .flatMap((line) => {
      const densityMatch = line.match(/^application-icon-(\d+):'([^']+)'/);
      if (densityMatch) {
        return [{ density: Number(densityMatch[1]), path: densityMatch[2] }];
      }

      const defaultMatch = line.match(/^application:.* icon='([^']+)'/);
      if (defaultMatch) {
        return [{ density: 0, path: defaultMatch[1] }];
      }

      return [];
    })
    .sort((a, b) => getIconScore(b) - getIconScore(a));

  return icons[0]?.path;
}

function getIconScore(icon: { density: number; path: string }) {
  const rasterBonus = isRasterIconPath(icon.path) ? 10_000 : 0;
  const pngBonus = icon.path.toLowerCase().endsWith(".png") ? 1_000 : 0;
  return rasterBonus + pngBonus + icon.density;
}

function getApkPathScore(apkPath: string) {
  if (apkPath.endsWith("/base.apk")) {
    return 1_000;
  }

  const densityScores: Record<string, number> = {
    xxxhdpi: 900,
    xxhdpi: 800,
    xhdpi: 700,
    hdpi: 600,
    mdpi: 500,
  };
  return (
    Object.entries(densityScores).find(([density]) =>
      apkPath.includes(density),
    )?.[1] ?? 0
  );
}

function isIconRelevantApkPath(apkPath: string) {
  return (
    apkPath.endsWith("/base.apk") ||
    /split_config\.(m|h|x|xx|xxx)hdpi\.apk$/.test(apkPath)
  );
}

async function findZipEntry(apkPaths: string[], entryPath: string) {
  for (const apkPath of apkPaths) {
    const entries = await getZipEntries(apkPath);
    if (entries.includes(entryPath)) {
      return { apkPath, entryPath };
    }
  }

  return undefined;
}

async function findRasterIconForXmlIcon(
  apkPaths: string[],
  xmlIconPath: string,
) {
  const iconName = basename(xmlIconPath, extname(xmlIconPath));
  const candidates = (
    await Promise.all(
      apkPaths.map(async (apkPath) => {
        const entries = await getZipEntries(apkPath);
        return entries
          .filter((entryPath) => isRasterIconPath(entryPath))
          .filter(
            (entryPath) => basename(entryPath, extname(entryPath)) === iconName,
          )
          .map((entryPath) => ({ apkPath, entryPath }));
      }),
    )
  ).flat();

  return candidates.sort(
    (a, b) =>
      getRasterEntryScore(b.entryPath) - getRasterEntryScore(a.entryPath),
  )[0];
}

async function getZipEntries(apkPath: string) {
  return (await spawnToString("zipinfo", ["-1", apkPath]))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function isRasterIconPath(path: string) {
  return /\.(png|webp)$/i.test(path);
}

function getRasterEntryScore(entryPath: string) {
  const densityScores: Record<string, number> = {
    xxxhdpi: 900,
    xxhdpi: 800,
    xhdpi: 700,
    hdpi: 600,
    mdpi: 500,
  };
  const densityScore =
    Object.entries(densityScores).find(([density]) =>
      entryPath.includes(density),
    )?.[1] ?? 0;
  const pngBonus = entryPath.toLowerCase().endsWith(".png") ? 1_000 : 0;
  return pngBonus + densityScore;
}

function getIconCacheDir() {
  const cacheDir = join(tmpdir(), "android-toolkit-raycast", "app-icons");
  mkdirSync(cacheDir, { recursive: true });
  return cacheDir;
}

function getSafeCacheName(value: string) {
  return createHash("sha1").update(value).digest("hex");
}

function getAaptPath() {
  const sdkRoots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(homedir(), "Library", "Android", "sdk"),
  ].filter((path): path is string => Boolean(path));

  for (const sdkRoot of sdkRoots) {
    const buildToolsRoot = join(sdkRoot, "build-tools");
    if (!existsSync(buildToolsRoot)) {
      continue;
    }

    const version = readdirSync(buildToolsRoot)
      .sort(compareAndroidBuildToolVersions)
      .reverse()
      .find((entry) => existsSync(join(buildToolsRoot, entry, "aapt")));

    if (version) {
      return join(buildToolsRoot, version, "aapt");
    }
  }

  return undefined;
}

function compareAndroidBuildToolVersions(a: string, b: string) {
  const aParts = a.split(".").map(Number);
  const bParts = b.split(".").map(Number);
  for (let index = 0; index < Math.max(aParts.length, bParts.length); index++) {
    const diff = (aParts[index] || 0) - (bParts[index] || 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return a.localeCompare(b);
}

async function spawnToString(
  command: string,
  args: string[],
  options: { allowStdoutOnError?: boolean } = {},
) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      if (options.allowStdoutOnError && stdout) {
        resolve(stdout);
        return;
      }

      reject(
        new Error(stderr || stdout || `${command} exited with code ${code}`),
      );
    });
  });
}

async function extractZipEntry(
  zipPath: string,
  entryPath: string,
  destinationPath: string,
) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("unzip", ["-p", zipPath, entryPath]);
    const destination = createWriteStream(destinationPath);
    let stderr = "";
    let childSucceeded = false;
    let destinationFinished = false;

    function resolveWhenDone() {
      if (childSucceeded && destinationFinished) {
        resolve();
      }
    }

    child.stdout.pipe(destination);
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    child.on("error", reject);
    destination.on("error", reject);
    destination.on("finish", () => {
      destinationFinished = true;
      resolveWhenDone();
    });
    child.on("close", (code) => {
      if (code === 0) {
        childSucceeded = true;
        resolveWhenDone();
        return;
      }

      reject(new Error(stderr || `unzip exited with code ${code}`));
    });
  });
}

async function convertImageToPng(inputPath: string, outputPath: string) {
  const attempts = [
    ["sips", ["-s", "format", "png", inputPath, "--out", outputPath]],
    ["ffmpeg", ["-y", "-i", inputPath, "-frames:v", "1", outputPath]],
    ["magick", [inputPath, outputPath]],
    ["convert", [inputPath, outputPath]],
  ] as const;

  let lastError: unknown;
  for (const [command, args] of attempts) {
    try {
      await runCommand(command, [...args]);
      if (existsSync(outputPath)) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Failed to convert image to PNG");
}

async function runCommand(command: string, args: string[]) {
  return await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args);
    let stderr = "";

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr || `${command} exited with code ${code}`));
    });
  });
}
