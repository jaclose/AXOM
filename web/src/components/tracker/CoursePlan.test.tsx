// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CourseBook } from "../../lib/bookshelf/courseBooks";
import type { QuestionBankBook } from "../../lib/bookshelf/questionBankBooks";
import { CoursePlan } from "./CoursePlan";

const book: CourseBook = {
  kind: "course",
  id: "course:t1:ftm:ftm1",
  title: "FTM 1",
  identifier: "FTM",
  shelf: "Term 1",
  count: 0,
  countLabel: "0 activities",
  state: "empty",
  module: "FTM 1",
  term: "Term 1",
  origin: "curriculum",
  weeks: [],
  unfiled: 0,
  done: 0,
};

const bank: QuestionBankBook = {
  kind: "question-bank",
  id: "bank:t1:ftm1",
  title: "FTM 1",
  identifier: "FTM",
  shelf: "Term 1",
  count: 3,
  countLabel: "3 questions",
  state: "available",
  module: "FTM 1",
  term: "Term 1",
  weeks: [],
  ready: 2,
  attempted: 0,
};

const callbacks = { onBack: () => {}, onOpen: () => {}, onCustomize: () => {} };

afterEach(cleanup);

describe("course-plan question availability", () => {
  it("labels remote reviewed counts as downloadable rather than locally ready", () => {
    render(<CoursePlan book={book} availableQuestions={12} {...callbacks} />);
    expect(screen.getByText("reviewed available to download").querySelector("b")?.textContent).toBe("12");
    expect(screen.queryByText(/12 ready questions/)).toBeNull();
  });

  it("labels only the derived local bank count as locally answer-ready", () => {
    render(<CoursePlan book={book} bank={bank} availableQuestions={12} {...callbacks} />);
    expect(screen.getByText("locally answer-ready").querySelector("b")?.textContent).toBe("2");
  });
});
