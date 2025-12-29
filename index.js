// index.js
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const app = express();
const PORT = process.env.PORT || 3000;

// Parse application/x-www-form-urlencoded (Slack sends this)
app.use(bodyParser.urlencoded({ extended: true }));

// In-memory storage for demo purposes
const kudos = {};
const expertise = {};

app.post("/slack/commands", async (req, res) => {
  const { command, text, user_id, user_name } = req.body;

  // Respond immediately to Slack (required <3s)
  res.send("");

  try {
    if (command === "/kudos") {
      // Update kudos
      const points = 5;
      kudos[user_id] = (kudos[user_id] || 0) + points;
      const total = kudos[user_id];

      // Send formatted message using Slack Blocks
      await axios.post(process.env.SLACK_WEBHOOK_URL, {
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `:tada: *Kudos to <@${user_id}>!*` }
          },
          { type: "divider" },
          {
            type: "section",
            text: { type: "mrkdwn", text: `*Why:* ${text}` }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Points:* ${points} 🎉  | *Total:* ${total} :star2:`
            }
          }
        ]
      });
    }

    else if (command === "/expertise") {
      // Example: add or show expertise
      const [action, ...rest] = text.split(" ");
      const skill = rest.join(" ");

      if (action === "add" && skill) {
        expertise[user_id] = expertise[user_id] || [];
        expertise[user_id].push(skill);

        await axios.post(process.env.SLACK_WEBHOOK_URL, {
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `:star2: <@${user_id}> added new expertise: *${skill}*`
              }
            }
          ]
        });
      } else if (action === "show") {
        const skills = (expertise[user_id] || []).join(", ") || "No expertise added yet.";
        await axios.post(process.env.SLACK_WEBHOOK_URL, {
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `:bulb: <@${user_id}>'s expertise: *${skills}*`
              }
            }
          ]
        });
      }
    }

    else if (command === "/leaderboard") {
      // Simple leaderboard sorted by total kudos
      const sorted = Object.entries(kudos)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5); // top 5

      const leaderboardText = sorted
        .map(([uid, total], i) => `${i + 1}. <@${uid}> — *${total} points*`)
        .join("\n") || "No kudos yet.";

      await axios.post(process.env.SLACK_WEBHOOK_URL, {
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: ":trophy: *Leaderboard*" } },
          { type: "divider" },
          { type: "section", text: { type: "mrkdwn", text: leaderboardText } }
        ]
      });
    }
  } catch (err) {
    console.error("Error sending Slack message:", err.message);
  }
});

// Simple landing page with "Add to Slack"
app.get("/", (req, res) => {
  res.send('<h1>BadgeUp</h1><a href="/slack/install">Add to Slack</a>');
});

// Slack OAuth install route
app.get("/slack/install", (req, res) => {
  const clientId = process.env.SLACK_CLIENT_ID;
  const redirectUri = process.env.REDIRECT_URI;
  const slackUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=commands,chat:write,users:read&redirect_uri=${redirectUri}`;
  res.redirect(slackUrl);
});

// Slack OAuth callback
app.get("/slack/oauth/callback", (req, res) => {
  res.send("Slack OAuth callback hit! BadgeUp is installed.");
});

app.listen(PORT, () => {
  console.log(`🚀 BadgeUp running on port ${PORT}`);
});
