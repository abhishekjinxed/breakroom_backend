import { prisma } from "../lib/prisma";

const adjectives = [
  "Curious",
  "Silent",
  "Happy",
  "Random",
  "Midnight",
  "Coffee",
  "Chill",
  "Busy",
  "Creative",
  "Sleepy",
];

const professions = [
  "Coder",
  "Designer",
  "Analyst",
  "Builder",
  "Writer",
  "Engineer",
  "Developer",
  "Creator",
  "Manager",
  "Thinker",
];

function generateUsername() {
  const adjective =
    adjectives[Math.floor(Math.random() * adjectives.length)];

  const profession =
    professions[Math.floor(Math.random() * professions.length)];

  const number = Math.floor(10 + Math.random() * 90);

  return `${adjective}${profession}${number}`;
}

export async function createAnonymousUser() {
  let username = generateUsername();

  // Make sure username is unique
  while (
    await prisma.user.findUnique({
      where: {
        anonymousUsername: username,
      },
    })
  ) {
    username = generateUsername();
  }

  const user = await prisma.user.create({
    data: {
      anonymousUsername: username,
      status: "ONLINE",
    },
  });

  return user;
}