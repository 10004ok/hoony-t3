import {
  createUserSchema,
  requestOtpSchema,
  verifyOtpSchema,
} from "@/schema/user.schema";
import { createRouter } from "server/createRouter";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime";
import * as trpc from "@trpc/server";
import { sendLoginEmail } from "@/utils/mailer";
import { baseUrl } from "../../constants";
import { decode, encode } from "@/utils/base64";
import { serialize } from "cookie";
import { signJwt } from "@/utils/jwt";

export const userRouter = createRouter()
  .mutation("resister-user", {
    input: createUserSchema,
    async resolve({ ctx, input }) {
      const { email, name } = input;
      try {
        const user = await ctx.prisma.user.create({
          data: {
            email,
            name,
          },
        });

        return user;
      } catch (e) {
        if (e instanceof PrismaClientKnownRequestError) {
          if (e.code === "P2002") {
            throw new trpc.TRPCError({
              code: "CONFLICT",
              message: "User Already Exists",
            });
          }
        }

        throw new trpc.TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Something went wrong",
        });
      }
    },
  })
  .mutation("request-otp", {
    input: requestOtpSchema,
    async resolve({ input, ctx }) {
      const { email, redirect } = input;
      const user = await ctx.prisma.user.findUnique({
        where: {
          email,
        },
      });

      if (!user) {
        throw new trpc.TRPCError({
          code: "NOT_FOUND",
          message: "user not found",
        });
      }
      const token = await ctx.prisma.loginToken.create({
        data: {
          redirect,
          user: {
            connect: {
              id: user.id,
            },
          },
        },
      });

      // send email to user
      sendLoginEmail({
        token: encode(`${token.id}:${user.email}`),
        url: baseUrl,
        email: user.email,
      });
      return true;
    },
  })
  .query("verify-otp", {
    input: verifyOtpSchema,
    async resolve({ input, ctx }) {
      const decoded = decode(input.hash).split(":");

      const [id, email] = decoded;

      const token = await ctx.prisma.loginToken.findFirst({
        where: {
          id,
          user: {
            email,
          },
        },
        include: {
          user: true,
        },
      });

      if (!token) {
        throw new trpc.TRPCError({
          code: "FORBIDDEN",
          message: "Invalid Token",
        });
      }

      const jwt = signJwt({
        email: token.user.email,
        id: token.user.id,
      });

      ctx.res.setHeader("Set-Cookie", serialize("token", jwt, { path: "/" }));
      return {
        redirect: token.redirect,
      };
    },
  })
  .query("me", {
    resolve({ ctx }) {
      return ctx.user;
    },
  });