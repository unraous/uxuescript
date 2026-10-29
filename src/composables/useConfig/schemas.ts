import { z } from "zod";

export const nonZeroU32 = z.coerce.number<string>().pipe(z.uint32().positive());

export const optionalPositiveNumber = z
  .string()
  .trim()
  .pipe(
    z.union([
      z.literal("").transform(() => null),
      z.coerce.number<string>().positive(),
    ]),
  );

export const boolean = z.boolean();
