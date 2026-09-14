import type { DataAdapter, DataWriteOptions } from "obsidian";
import { isCloakPath } from "./scope";

export interface CloakContext {
  isArmed(): boolean;
  reveal(path: string, data: string): Promise<string>;
  seal(path: string, data: string): Promise<string>;
}

type AdapterWithOptionalBinary = DataAdapter & {
  appendBinary?: (
    normalizedPath: string,
    data: ArrayBuffer,
    options?: DataWriteOptions,
  ) => Promise<void>;
};

function textFromBuffer(data: ArrayBuffer): string {
  return new TextDecoder("utf-8").decode(data);
}

function bufferFromText(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

export interface PatchedAdapter {
  unpatch: () => void;
  readRaw: (normalizedPath: string) => Promise<string>;
  writeRaw: (
    normalizedPath: string,
    data: string,
    options?: DataWriteOptions,
  ) => Promise<void>;
}

export function patchAdapter(adapter: DataAdapter, ctx: CloakContext): PatchedAdapter {
  const fs = adapter as AdapterWithOptionalBinary;
  const originalRead = fs.read.bind(fs);
  const originalReadBinary = fs.readBinary.bind(fs);
  const originalWrite = fs.write.bind(fs);
  const originalWriteBinary = fs.writeBinary.bind(fs);
  const originalAppend = fs.append.bind(fs);
  const originalProcess = fs.process.bind(fs);
  const originalAppendBinary = fs.appendBinary?.bind(fs);

  fs.read = async (normalizedPath: string): Promise<string> => {
    const data = await originalRead(normalizedPath);
    if (!isCloakPath(normalizedPath)) {
      return data;
    }
    return ctx.reveal(normalizedPath, data);
  };

  fs.readBinary = async (normalizedPath: string): Promise<ArrayBuffer> => {
    const data = await originalReadBinary(normalizedPath);
    if (!isCloakPath(normalizedPath)) {
      return data;
    }
    const revealed = await ctx.reveal(normalizedPath, textFromBuffer(data));
    return bufferFromText(revealed);
  };

  fs.write = async (
    normalizedPath: string,
    data: string,
    options?: DataWriteOptions,
  ): Promise<void> => {
    if (!isCloakPath(normalizedPath) || !ctx.isArmed()) {
      return originalWrite(normalizedPath, data, options);
    }
    const sealed = await ctx.seal(normalizedPath, data);
    return originalWrite(normalizedPath, sealed, options);
  };

  fs.writeBinary = async (
    normalizedPath: string,
    data: ArrayBuffer,
    options?: DataWriteOptions,
  ): Promise<void> => {
    if (!isCloakPath(normalizedPath) || !ctx.isArmed()) {
      return originalWriteBinary(normalizedPath, data, options);
    }
    const sealed = await ctx.seal(normalizedPath, textFromBuffer(data));
    return originalWrite(normalizedPath, sealed, options);
  };

  fs.append = async (
    normalizedPath: string,
    data: string,
    options?: DataWriteOptions,
  ): Promise<void> => {
    if (!isCloakPath(normalizedPath) || !ctx.isArmed()) {
      return originalAppend(normalizedPath, data, options);
    }
    let existing = "";
    try {
      existing = await ctx.reveal(normalizedPath, await originalRead(normalizedPath));
    } catch {
      existing = "";
    }
    const sealed = await ctx.seal(normalizedPath, existing + data);
    return originalWrite(normalizedPath, sealed, options);
  };

  fs.process = async (
    normalizedPath: string,
    fn: (data: string) => string,
    options?: DataWriteOptions,
  ): Promise<string> => {
    if (!isCloakPath(normalizedPath) || !ctx.isArmed()) {
      return originalProcess(normalizedPath, fn, options);
    }
    const current = await ctx.reveal(normalizedPath, await originalRead(normalizedPath));
    const next = fn(current);
    const sealed = await ctx.seal(normalizedPath, next);
    await originalWrite(normalizedPath, sealed, options);
    return next;
  };

  if (originalAppendBinary && fs.appendBinary) {
    fs.appendBinary = async (
      normalizedPath: string,
      data: ArrayBuffer,
      options?: DataWriteOptions,
    ): Promise<void> => {
      if (!isCloakPath(normalizedPath) || !ctx.isArmed()) {
        return originalAppendBinary(normalizedPath, data, options);
      }
      let existing = "";
      try {
        existing = await ctx.reveal(normalizedPath, await originalRead(normalizedPath));
      } catch {
        existing = "";
      }
      const sealed = await ctx.seal(normalizedPath, existing + textFromBuffer(data));
      return originalWrite(normalizedPath, sealed, options);
    };
  }

  return {
    readRaw: originalRead,
    writeRaw: originalWrite,
    unpatch: () => {
      fs.read = originalRead;
      fs.readBinary = originalReadBinary;
      fs.write = originalWrite;
      fs.writeBinary = originalWriteBinary;
      fs.append = originalAppend;
      fs.process = originalProcess;
      if (originalAppendBinary) {
        fs.appendBinary = originalAppendBinary;
      }
    },
  };
}
