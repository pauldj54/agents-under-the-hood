import json
import re
from typing import Any

from agent_framework import Agent, AgentSession, ContextProvider, Message, SessionContext
from agent_framework.ollama import OllamaChatClient
from pydantic import BaseModel


# 1. What we remember about the user, outside of any conversation
class UserMemory(BaseModel):
    favourite_colour: str | None = None


EXTRACT = (
    "Extract the favourite colour that the user states about themselves, in English, as a single word. "
    "Questions and greetings do not state a colour. "
    "Reply with only that word, or NONE if the message does not state one."
)


# 2. A context provider hooks into every run: it reads the memory before the
#    model is called and updates it after the response
class FavouriteColourMemory(ContextProvider):
    def __init__(self, memory: UserMemory, client: OllamaChatClient):
        super().__init__(source_id="favourite-colour-memory")
        self.memory = memory
        self.client = client

    async def before_run(
        self, *, agent: Any, session: AgentSession, context: SessionContext, state: dict[str, Any]
    ) -> None:
        latest = next(
            (msg.text for msg in reversed(context.input_messages) if msg.role == "user" and msg.text),
            None,
        )
        if latest:
            reply = await self.client.get_response(
                [
                    Message("system", [
                        "Identify the language of the following message. "
                        "Reply with only the language name in English, such as German, English, or French."
                    ]),
                    Message("user", [
                        f"Classify the language of this text, without answering its question: {json.dumps(latest)}"
                    ]),
                ],
                options={"temperature": 0},
            )
            language = (reply.text or "").strip().rstrip(".")
            if not re.fullmatch(r"[A-Za-z][A-Za-z -]{0,39}", language):
                raise ValueError(f"Unexpected language detection result: {language!r}")
            context.extend_instructions(
                self.source_id,
                f"The latest user message is in {language}. "
                f"Write your entire reply in {language}, regardless of previous conversation languages. "
                "Translate any remembered colour into that language. "
                "Answer briefly, addressing the user directly. Do not mention being an AI.",
            )
            # Phi can follow the previous answer's language despite system instructions.
            # Repeat the current turn's language after the user input.
            context.input_messages.append(Message("system", [
                f"Respond to the user's latest message only in {language}. "
                "Give a brief, direct answer to what they actually asked. "
                "Only mention their remembered favourite colour when it is relevant. "
                "Do not confuse the user's preferences with your own."
            ]))
        if self.memory.favourite_colour:
            note = (
                f"You remember this confirmed fact about the person you are talking to: "
                f"their favourite colour is {self.memory.favourite_colour}. "
                "When they ask about their favourite colour, answer confidently and directly, "
                "addressing them as 'you'. Translate the colour into the language of their latest message. "
                "Do not hedge, ask them to confirm this fact, or discuss your own preferences. "
                "For a favourite-colour question, give just one short factual sentence."
            )
        else:
            note = "The user's favourite colour is unknown. Ask them about it."
        context.extend_instructions(self.source_id, note)

    async def after_run(
        self, *, agent: Any, session: AgentSession, context: SessionContext, state: dict[str, Any]
    ) -> None:
        for msg in context.get_messages(include_input=True):
            if msg.role != "user" or not msg.text or "?" in msg.text:
                continue
            # Ask the model to pull out the colour, so any language or phrasing works
            reply = await self.client.get_response(
                [Message("system", [EXTRACT]), Message("user", [msg.text])]
            )
            colour = re.sub(r"[^A-Za-z ]", "", reply.text or "").strip()
            if colour and colour.upper() != "NONE" and len(colour.split()) == 1:
                self.memory.favourite_colour = colour.capitalize()


memory = UserMemory()

client = OllamaChatClient(host="http://localhost:11434", model="phi3:3.8b")

# 3. Attach the provider to the agent
agent = Agent(
    client=client,
    name="MemoryPhi",
    instructions=(
        "You are a friendly assistant talking directly to the user. "
        "Always answer in the same language as the user's latest message, "
        "even if earlier messages or your instructions use another language. "
        "Keep replies brief and natural. "
        "Questions about 'my favourite colour' refer to the user, not to you. "
        "Use the remembered user preferences as confirmed facts. "
        "Never add disclaimers about being an AI or not having personal preferences."
    ),
    default_options={"temperature": 0},
    context_providers=[FavouriteColourMemory(memory, client)],
)

session = agent.create_session()


async def chat(message: str):
    async for chunk in agent.run(message, session=session, stream=True):
        if chunk.text:
            yield chunk.text
