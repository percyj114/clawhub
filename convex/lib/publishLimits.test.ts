import { describe, expect, it } from "vitest";
import {
  estimatePackageMultipartUploadBytes,
  findOversizedPublishFile,
  getClawPackSizeError,
  getPackageMultipartSizeError,
  getPublishFileSizeError,
  getPublishTotalSizeError,
  isPackageMultipartUploadTooLarge,
  MAX_CLAWPACK_BYTES,
  MAX_PACKAGE_MULTIPART_BYTES,
  MAX_PUBLISH_FILE_BYTES,
} from "./publishLimits";

describe("publishLimits", () => {
  it("finds files over the max publish file size", () => {
    expect(
      findOversizedPublishFile([
        { path: "small.txt", size: 128 },
        { path: "big.txt", size: MAX_PUBLISH_FILE_BYTES + 1 },
      ]),
    ).toEqual({
      path: "big.txt",
      size: MAX_PUBLISH_FILE_BYTES + 1,
    });
  });

  it("formats user-facing size errors", () => {
    expect(getPublishFileSizeError("dist/plugin.wasm")).toBe(
      'File "dist/plugin.wasm" exceeds 10MB limit',
    );
    expect(getPublishTotalSizeError("package")).toBe("Package exceeds 50MB limit");
    expect(getClawPackSizeError("demo-1.0.0.tgz")).toBe(
      'ClawPack "demo-1.0.0.tgz" exceeds 18MB multipart upload limit',
    );
    expect(getPackageMultipartSizeError()).toBe(
      "Package upload exceeds 18MB multipart upload limit",
    );
  });

  it("keeps package multipart uploads below the Convex HTTP action body limit", () => {
    expect(MAX_PACKAGE_MULTIPART_BYTES).toBe(18 * 1024 * 1024);
    expect(MAX_CLAWPACK_BYTES).toBe(MAX_PACKAGE_MULTIPART_BYTES);
    expect(MAX_CLAWPACK_BYTES).toBeGreaterThan(MAX_PUBLISH_FILE_BYTES);
  });

  it("counts payload and per-part overhead in package multipart uploads", () => {
    expect(
      estimatePackageMultipartUploadBytes({
        payloadJson: "{}",
        fileFieldName: "files[]",
        files: [{ name: "openclaw.plugin.json", size: 2, type: "application/json" }],
      }),
    ).toBeGreaterThan(2);
    expect(
      isPackageMultipartUploadTooLarge({
        payloadJson: "x".repeat(MAX_PACKAGE_MULTIPART_BYTES),
        fileFieldName: "files[]",
        files: [{ name: "openclaw.plugin.json", size: 2, type: "application/json" }],
      }),
    ).toBe(true);
  });
});
