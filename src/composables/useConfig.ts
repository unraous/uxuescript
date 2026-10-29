import { showError } from "@/services/errors";
import type { z } from "zod";

export function useConfig<T>(
  read: () => Promise<T>,
  apply: (config: T) => void | Promise<void>,
  errorMessage: string,
) {
  const load = async () => {
    try {
      await apply(await read());
    } catch (cause) {
      await showError(errorMessage, cause);
    }
  };

  const save = async (update: () => Promise<unknown>) => {
    try {
      await update();
    } catch (cause) {
      // 弹窗等待用户确认；回填不能等到关闭弹窗之后才执行。
      void showError(errorMessage, cause);
    }
    await load();
  };

  const saveField = <K extends keyof T, Input>(
    write: (config: T) => Promise<unknown>,
    key: K,
    input: Input,
    schema: z.ZodType<T[K], Input>,
  ) =>
    save(async () => {
      const value = schema.parse(input);
      const current = await read();
      await write({ ...current, [key]: value });
    });

  return { load, save, saveField };
}
