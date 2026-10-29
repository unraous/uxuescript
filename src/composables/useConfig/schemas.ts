import { z } from "zod";

const integerMessage = "请输入大于 0 的整数。";
const optionalNumberMessage = "请输入大于 0 的数字，或留空关闭。";

export const nonZeroU32 = z.coerce
  .number<string>(integerMessage)
  .pipe(z.uint32(integerMessage).positive(integerMessage));

export const optionalPositiveNumber = z
  .string(optionalNumberMessage)
  .trim()
  .pipe(
    z.union(
      [
        z.literal("").transform(() => null),
        z.coerce
          .number<string>(optionalNumberMessage)
          .positive(optionalNumberMessage),
      ],
      optionalNumberMessage,
    ),
  );

export const boolean = z.boolean("请选择开启或关闭。");
