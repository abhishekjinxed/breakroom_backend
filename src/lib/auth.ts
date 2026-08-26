import jwt, { JwtPayload } from "jsonwebtoken";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET is not defined");
  }

  return secret;
}

const jwtSecret = getJwtSecret();

export function createToken(userId: string) {
  return jwt.sign(
    {
      userId,
    },
    jwtSecret,
    {
      expiresIn: "30d",
    }
  );
}

export function verifyToken(token: string) {
  const payload = jwt.verify(token, jwtSecret);

  if (
    typeof payload === "string" ||
    typeof (payload as JwtPayload).userId !== "string"
  ) {
    throw new Error("Invalid token payload");
  }

  return { userId: (payload as JwtPayload).userId as string };
}
