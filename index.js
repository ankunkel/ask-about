require("dotenv").config();

const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// --------------------- In-memory storage ---------------------
let kudos = {}; // { userId: points }
let users = {}; // { userId: { domains: [], badges: [] } }
let questions = []; // { id, userId, text, domain, answeredBy: [], bestAnswer: null }
let domainsList = ["React", "Node.js", "Python"]; // Predefined domains
let badgesList = ["Expert", "Helper", "Mentor"]; // Predefined badges

// --------------------- Helper ---------------------
async function postToSlack(message) {
  try {
    await axios.post(process.env.SLACK_WEBHOOK_URL, { text: message });
  } catch (err) {
    console.error("Error posting to Slack:", err);
  }
}

// --------------------- /slack/commands ---------------------
app.post("/slack/commands", async (req, res) => {
  const { command, text, user_id, user_name } = req.body;
  res.send(""); // Must respond <3s

  try {
    switch (command) {
      case "/kudos": {
        kudos[user_id] = (kudos[user_id] || 0) + 5;
        await postToSlack(
          `:tada: Kudos to <@${user_id}>!\n========\nWhy: ${text}\n5 points! 🎉\nTotal: ${kudos[user_id]}`
        );
        break;
      }

      case "/domain": {
        const domain = text.trim();
        if (!domain) {
          await postToSlack("❌ Please provide a domain.");
          break;
        }
        if (!users[user_id]) users[user_id] = { domains: [], badges: [] };
        if (!users[user_id].domains.includes(domain)) users[user_id].domains.push(domain);
        if (!domainsList.includes(domain)) domainsList.push(domain);
        await postToSlack(
          `✅ <@${user_id}> added domain: ${domain}\nYour domains: ${users[user_id].domains.join(", ")}`
        );
        break;
      }

      case "/badge": {
        const badge = text.trim();
        if (!badge) {
          await postToSlack("❌ Please provide a badge.");
          break;
        }
        if (!users[user_id]) users[user_id] = { domains: [], badges: [] };
        if (!users[user_id].badges.includes(badge)) users[user_id].badges.push(badge);
        if (!badgesList.includes(badge)) badgesList.push(badge);
        await postToSlack(
          `🏅 <@${user_id}> earned badge: ${badge}\nYour badges: ${users[user_id].badges.join(", ")}`
        );
        break;
      }

      case "/domains": {
        await postToSlack(`📚 All domains: ${domainsList.join(", ")}`);
        break;
      }

      case "/badges": {
        await postToSlack(`🏅 All badges: ${badgesList.join(", ")}`);
        break;
      }

      case "/question": {
        const [domain, ...questionParts] = text.split("|").map(s => s.trim());
        if (!domain || questionParts.length === 0) {
          await postToSlack("❌ Usage: /question [domain] | [your question]");
          break;
        }
        const questionText = questionParts.join(" ");
        const questionId = questions.length + 1;
        questions.push({ id: questionId, userId: user_id, text: questionText, domain, answeredBy: [], bestAnswer: null });
        await postToSlack(`❓ <@${user_id}> asked a question in ${domain}:\n${questionText}\nQuestion ID: ${questionId}`);
        break;
      }

      case "/question-answer": {
        const [qidStr, answerText] = text.split("|").map(s => s.trim());
        const qid = parseInt(qidStr);
        const question = questions.find(q => q.id === qid);
        if (!question) {
          await postToSlack(`❌ Question ID ${qid} not found.`);
          break;
        }
        question.answeredBy.push({ userId: user_id, answer: answerText });
        await postToSlack(`✅ <@${user_id}> answered question ID ${qid}:\n${answerText}`);
        break;
      }

      case "/question-best": {
        const [qidStr, bestUserId] = text.split("|").map(s => s.trim());
        const qid = parseInt(qidStr);
        const question = questions.find(q => q.id === qid);
        if (!question) {
          await postToSlack(`❌ Question ID ${qid} not found.`);
          break;
        }
        question.bestAnswer = bestUserId;
        await postToSlack(`🏆 <@${bestUserId}> was marked as best answer for question ID ${qid}`);
        break;
      }

      case "/questions": {
        const domainFilter = text.trim();
        const filteredQuestions = domainFilter
          ? questions.filter(q => q.domain.toLowerCase() === domainFilter.toLowerCase())
          : questions;
        if (!filteredQuestions.length) {
          await postToSlack("❌ No questions found.");
          break;
        }
        const message = filteredQuestions
          .map(q => `ID ${q.id} | ${q.domain} | <@${q.userId}>: ${q.text}`)
          .join("\n");
        await postToSlack(`📄 Questions:\n${message}`);
        break;
      }

      case "/ask-experts": {
        const domainFilter = text.trim();
        const experts = Object.keys(users)
          .filter(uid => users[uid].domains.includes(domainFilter) || users[uid].badges.includes(domainFilter))
          .map(uid => `<@${uid}>`);
        await postToSlack(experts.length ? `💡 Experts for ${domainFilter}: ${experts.join(", ")}` : `❌ No experts found for ${domainFilter}`);
        break;
      }

      case "/leaderboard": {
        const topUsers = Object.keys(kudos)
          .map(id => ({ user: id, points: kudos[id] }))
          .sort((a, b) => b.points - a.points)
          .slice(0, 10)
          .map(entry => `<@${entry.user}>: ${entry.points} pts`);
        await postToSlack(`📊 Leaderboard:\n${topUsers.join("\n")}`);
        break;
      }

      case "/help": {
        await postToSlack(`📝 Available commands:
• /kudos [@user] [reason]
• /domain [domain]
• /badge [badge]
• /domains
• /badges
• /question [domain] | [question]
• /question-answer [questionId] | [answer]
• /question-best [questionId] | [user]
• /questions [domain?]
• /ask-experts [domain]
• /leaderboard`);
        break;
      }

      default:
        await postToSlack(`❌ Unknown command: ${command}`);
    }
  } catch (err) {
    console.error("Error handling command:", err);
    await postToSlack(`❌ Error processing command ${command}`);
  }
});

// --------------------- /slack/interactivity for autocomplete ---------------------
app.post("/slack/interactivity", async (req, res) => {
  try {
    const payload = JSON.parse(req.body.payload);

    if (payload.type === "block_suggestion") {
      const { name, value } = payload;
      let options = [];

      if (name === "domain") {
        options = domainsList
          .filter(d => d.toLowerCase().includes(value.toLowerCase()))
          .map(d => ({ text: { type: "plain_text", text: d }, value: d }));
      } else if (name === "badge") {
        options = badgesList
          .filter(b => b.toLowerCase().includes(value.toLowerCase()))
          .map(b => ({ text: { type: "plain_text", text: b }, value: b }));
      }

      res.json({ options });
      return;
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Interactivity error:", err);
    res.sendStatus(500);
  }
});

// --------------------- Start server ---------------------
app.listen(PORT, () => console.log(`🚀 BadgeUp running on port ${PORT}`));
